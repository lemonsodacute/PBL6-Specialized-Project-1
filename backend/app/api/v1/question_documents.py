"""Owner-scoped document -> private drafts -> explicit atomic Question import."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from threading import BoundedSemaphore
from time import monotonic
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from fastapi.routing import APIRoute
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.deps import roles
from app.api.responses import ok
from app.core.database import get_db
from app.models.entities import Question, QuestionBank, User, UserRole
from app.schemas.question_documents import DraftConfiguration, ImportDrafts, QualityReviewInput
from app.core.config import get_settings
from app.services.question_document_extract import DocumentError, MAX_FILE_BYTES, validate_file
from app.services import question_document_drafts as storage
from app.services import question_images as attachments
from app.services.question_generation import generation_available, get_question_generation_provider
from app.services.ai_provider import provider_status, ai_trace
from app.services.ai_metrics import generation as measured_generation
from app.services.audit import record_audit
from app.services.question_quality import near_duplicate, review_drafts, summarize

_extract_slots = BoundedSemaphore(2)
WORKER = Path(__file__).resolve().parents[3] / 'scripts' / 'question_document_worker.py'


class DocumentRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def private_handler(request):
            try:
                response = await handler(request)
            except DocumentError as exc:
                ai_trace('document_error', error_code=exc.code, error_type='DocumentError')
                status = (404 if exc.code == 'DOCUMENT_NOT_FOUND' else 410 if exc.code == 'DOCUMENT_EXPIRED'
                          else 409 if exc.code in {'DOCUMENT_BUSY', 'DOCUMENT_ALREADY_IMPORTED', 'DUPLICATE_QUESTIONS'}
                          else 413 if exc.code == 'DOCUMENT_TOO_LARGE'
                          else 503 if exc.code in {'AI_NOT_CONFIGURED', 'AI_PROVIDER_UNAVAILABLE', 'GENERATION_NOT_CONFIGURED', 'GENERATION_UNAVAILABLE', 'DOCUMENT_STORAGE_ERROR'}
                          else 429 if exc.code == 'AI_RATE_LIMITED'
                          else 502 if exc.code in {'AI_REQUEST_FAILED', 'AI_MODEL_UNSUPPORTED', 'AI_AUTH_FAILED', 'AI_INVALID_RESPONSE', 'AI_PARSE_ERROR'}
                          else 504 if exc.code in {'GENERATION_TIMEOUT', 'AI_TIMEOUT'} else 422)
                raise HTTPException(status, detail={'code': exc.code, 'message': exc.message, 'details': None},
                                    headers={'Cache-Control': 'no-store'}) from None
            except Exception as exc:
                # Keep unexpected exceptions visible with their stage/type; never
                # log exception text or locals (which can include source content).
                ai_trace('document_internal_error', error_code='INTERNAL_ERROR', error_type=type(exc).__name__)
                raise
            response.headers['Cache-Control'] = 'no-store'
            response.headers['X-Content-Type-Options'] = 'nosniff'
            return response
        return private_handler


router = APIRouter(route_class=DocumentRoute)
actor = roles(UserRole.teacher, UserRole.admin)


def require_bank(db, bank_id, user, *, lock=False):
    query = select(QuestionBank).where(QuestionBank.id == bank_id, QuestionBank.is_active.is_(True))
    if user.role != UserRole.admin:
        query = query.where(QuestionBank.created_by == user.id)
    if lock:
        query = query.with_for_update()
    bank = db.scalar(query.execution_options(populate_existing=True))
    if bank is None:
        raise HTTPException(404, detail={'code': 'NOT_FOUND', 'message': 'Không tìm thấy ngân hàng câu hỏi.', 'details': None})
    return bank


def extract_in_worker(content, extension):
    if not _extract_slots.acquire(blocking=False):
        raise DocumentError('DOCUMENT_BUSY', 'Máy chủ đang đọc tài liệu khác. Vui lòng thử lại sau ít phút.')
    try:
        result = subprocess.run([sys.executable, str(WORKER), extension], input=content,
                                capture_output=True, timeout=30, cwd=WORKER.parents[1])
        if result.returncode != 0 or len(result.stdout) > 40_000_000:
            raise DocumentError('CORRUPT_DOCUMENT', 'Chưa đọc được tài liệu. File có thể bị hỏng hoặc quá phức tạp.')
        try:
            payload = json.loads(result.stdout)
        except ValueError:
            raise DocumentError('CORRUPT_DOCUMENT', 'Không đọc được tài liệu. Vui lòng kiểm tra lại file.') from None
        if 'error' in payload:
            raise DocumentError(payload['error']['code'], payload['error']['message'])
        ai_trace('document_extraction', input_chars=sum(len(s['text']) for s in payload['data']['sections']), provider_called=False)
        return payload['data']
    except subprocess.TimeoutExpired:
        raise DocumentError('DOCUMENT_PARSE_TIMEOUT', 'Tài liệu mất quá lâu để đọc. Vui lòng chia nhỏ hoặc xuất lại file.') from None
    finally:
        _extract_slots.release()


def duplicate_flags(db, bank_id, drafts):
    existing = list(db.scalars(select(Question.content).where(Question.question_bank_id == bank_id)))
    seen = []
    for draft in drafts:
        draft['duplicate'] = any(near_duplicate(draft['content'], content) for content in existing + seen)
        check = draft.get('quality_check')
        if check and draft['duplicate']:
            check.update(status='review', flags=sorted(set(check['flags'] + ['POTENTIAL_DUPLICATE'])))
        seen.append(draft['content'])
    return drafts


@router.get('/{bank_id}/document-capabilities')
def capabilities(bank_id: UUID, db: Session = Depends(get_db), user: User = Depends(actor)):
    require_bank(db, bank_id, user)
    return ok({'generation_available': generation_available(), 'max_file_bytes': MAX_FILE_BYTES,
               'provider_status': provider_status(), 'supports_text': True,
               'max_questions': 100, 'formats': ['pdf', 'docx'],
               'vision_available': get_question_generation_provider().supports_vision})


@router.post('/{bank_id}/documents')
async def upload_document(bank_id: UUID, document: UploadFile = File(...),
                          db: Session = Depends(get_db), user: User = Depends(actor)):
    require_bank(db, bank_id, user)  # Before reading/uploading/parsing untrusted input.
    user_id = user.id
    db.rollback()
    content = await document.read(MAX_FILE_BYTES + 1)
    try:
        extension = validate_file(document.filename or '', document.content_type, content)
        extracted = await run_in_threadpool(extract_in_worker, content, extension)
        session = await run_in_threadpool(storage.new_session, bank_id, user_id, document.filename or '', extracted)
        ai_trace('document_chunks', chunk_count=len(session['chunks']), input_chars=session['character_count'], provider_called=False)
    finally:
        await document.close()
    return ok(storage.public_session(session, include_text=True))


@router.get('/{bank_id}/documents/{document_id}')
def get_document(bank_id: UUID, document_id: UUID, db: Session = Depends(get_db), user: User = Depends(actor)):
    require_bank(db, bank_id, user)
    with storage.document_session(document_id, bank_id, user.id) as session:
        return ok(storage.public_session(session, include_text=True))


@router.delete('/{bank_id}/documents/{document_id}')
def discard_document(bank_id: UUID, document_id: UUID, db: Session = Depends(get_db), user: User = Depends(actor)):
    require_bank(db, bank_id, user)
    with storage.document_session(document_id, bank_id, user.id):
        storage.remove_source(document_id)
        (storage.DOCUMENT_ROOT / f'{document_id}.json').unlink(missing_ok=True)
    return ok({'discarded': True})


@router.get('/{bank_id}/documents/{document_id}/images/{image_id}')
def preview_image(bank_id: UUID, document_id: UUID, image_id: UUID,
                  db: Session = Depends(get_db), user: User = Depends(actor)):
    require_bank(db, bank_id, user)
    with storage.document_session(document_id, bank_id, user.id) as session:
        try:
            content = storage.source_image_path(session, image_id).read_bytes()
        except OSError:
            raise DocumentError('DOCUMENT_NOT_FOUND', 'Hình ảnh không còn khả dụng.') from None
        return Response(content, media_type='image/png')


def require_editable(session):
    if session['imported']:
        raise DocumentError('DOCUMENT_ALREADY_IMPORTED', 'Phiên này đã được thêm vào ngân hàng. Vui lòng tạo phiên mới để nhập thêm.')


@router.post('/{bank_id}/documents/{document_id}/drafts')
def prepare_drafts(bank_id: UUID, document_id: UUID, payload: DraftConfiguration,
                   db: Session = Depends(get_db), user: User = Depends(actor)):
    require_bank(db, bank_id, user)
    with storage.document_session(document_id, bank_id, user.id) as session:
        require_editable(session)
        session['config'] = payload.model_dump()
        if payload.mode == 'import':
            try:
                parsed = storage.parse_existing_questions(session['sections'], topic=payload.topic, images=session.get('images', []))
            except ValidationError:
                raise DocumentError('INVALID_DRAFT', 'Một câu hỏi hoặc đáp án trong tài liệu quá dài. Vui lòng chia nhỏ nội dung trước khi nhập.') from None
            session['questions'] = duplicate_flags(db, bank_id, parsed)
            if not get_question_generation_provider().supports_vision:
                for draft in session['questions']:
                    if draft['images']:
                        draft['warning_codes'] = ['IMAGE_REQUIRES_VISION']
            session['batches'] = []
        else:
            if not generation_available():
                error = provider_status()['error']
                raise DocumentError(error['code'], error['message'])
            session['questions'] = []
            session['batches'] = storage.generation_plan(session['chunks'], payload.count)
        storage.save_session(session)
        return ok(storage.public_session(session))


@router.post('/{bank_id}/documents/{document_id}/batches/{batch_index}')
def generate_batch(bank_id: UUID, document_id: UUID, batch_index: int,
                   db: Session = Depends(get_db), user: User = Depends(actor)):
    require_bank(db, bank_id, user)
    user_id = user.id
    with storage.document_session(document_id, bank_id, user_id) as session:
        require_editable(session)
        if not session['config'] or session['config']['mode'] != 'generate' or not 0 <= batch_index < len(session['batches']):
            raise DocumentError('INVALID_BATCH', 'Lượt tạo câu hỏi chưa hợp lệ. Vui lòng kiểm tra cấu hình.')
        batch = session['batches'][batch_index]
        ai_trace('question_batch', chunk_index=batch_index, provider_called=False)
        if not batch['complete']:
            requirements = batch.get('pending_requirements') or batch['requirements']
            sources = [source for source in batch['sources'] if source['id'] in requirements]
            excluded = list(db.scalars(select(Question.content).where(Question.question_bank_id == bank_id)))
            excluded.extend(question['content'] for question in session['questions'])
            # No DB transaction is held while the provider runs.
            db.rollback()
            try:
                generated = measured_generation(db, user, session, storage.generation_sources(session, sources),
                    requirements, excluded, get_question_generation_provider())
            except DocumentError as exc:
                batch['error'] = {'code': exc.code, 'message': exc.message}
                if getattr(exc, 'quality_summary', None):
                    previous = batch.get('quality_summary') or {}
                    summary = dict(exc.quality_summary)
                    for key in ('generated', 'rejected', 'duplicate', 'unsupported', 'ambiguous', 'valid', 'needs_review'):
                        summary[key] = summary.get(key, 0) + previous.get(key, 0)
                    summary['rejected_reasons'] = {key: previous.get('rejected_reasons', {}).get(key, 0) + exc.quality_summary.get('rejected_reasons', {}).get(key, 0)
                        for key in ('duplicate', 'unsupported', 'ambiguous')}
                    batch['quality_summary'] = summary
                storage.save_session(session)
                raise
            require_bank(db, bank_id, user)
            session['questions'].extend(generated)
            duplicate_flags(db, bank_id, session['questions'])
            batch['complete'] = not bool(getattr(generated, 'pending_requirements', None))
            batch['generated_count'] = (batch.get('generated_count') or 0) + len(generated)
            if getattr(generated, 'quality_summary', None):
                previous = batch.get('quality_summary') or {}
                summary = dict(generated.quality_summary)
                for key in ('generated', 'rejected', 'duplicate', 'unsupported', 'ambiguous', 'valid', 'needs_review'):
                    summary[key] = summary.get(key, 0) + previous.get(key, 0)
                summary['rejected_reasons'] = {key: previous.get('rejected_reasons', {}).get(key, 0) + generated.quality_summary.get('rejected_reasons', {}).get(key, 0)
                    for key in ('duplicate', 'unsupported', 'ambiguous')}
                batch['quality_summary'] = summary
            if batch['complete']:
                batch.pop('error', None)
                batch.pop('pending_requirements', None)
            else:
                batch['pending_requirements'] = generated.pending_requirements
                batch['error'] = generated.partial_error
            if batch['complete'] and batch['generated_count'] < sum(batch['requirements'].values()):
                warning = 'Một phần tài liệu chưa đủ căn cứ để tạo số câu yêu cầu. Chỉ giữ các câu có nguồn rõ ràng.'
                if warning not in session['warnings']:
                    session['warnings'].append(warning)
            try:
                storage.save_session(session)
            except OSError:
                ai_trace('draft_persistence', chunk_index=batch_index, persist_success=False,
                         error_code='DOCUMENT_STORAGE_ERROR', error_type='OSError')
                raise DocumentError('DOCUMENT_STORAGE_ERROR', 'AI đã trả kết quả nhưng máy chủ chưa lưu được bản nháp. Vui lòng thử lại.') from None
            ai_trace('draft_persistence', chunk_index=batch_index, draft_count=len(session['questions']), persist_success=True)
        return ok(storage.public_session(session))


@router.post('/{bank_id}/documents/{document_id}/quality')
def check_draft_quality(bank_id: UUID, document_id: UUID, payload: QualityReviewInput,
                       db: Session = Depends(get_db), user: User = Depends(actor)):
    require_bank(db, bank_id, user)
    with storage.document_session(document_id, bank_id, user.id) as session:
        require_editable(session)
        originals = {draft['id']: draft for draft in session['questions']}
        incoming_ids = [str(draft.id) for draft in payload.questions]
        if len(set(incoming_ids)) != len(incoming_ids) or any(id not in originals for id in incoming_ids):
            raise DocumentError('INVALID_DRAFT', 'Một bản nháp không thuộc phiên tài liệu này.')
        drafts = []
        for incoming in payload.questions or [None] * len(originals):
            if incoming is None:
                drafts = [dict(draft) for draft in originals.values()]
                break
            original = originals[str(incoming.id)]
            draft = dict(original)
            for key in ('content', 'type', 'difficulty', 'topic', 'default_points', 'options', 'answers', 'explanation'):
                draft[key] = incoming.model_dump(mode='json')[key]
            images = {image['id']: image for image in session.get('images', [])}
            expected = {image['id'] for image in original.get('images', [])}
            selected = {str(image.id) for image in incoming.images}
            if not expected.issubset(selected) or not selected.issubset(images) or len(selected) != len(incoming.images):
                raise DocumentError('INVALID_DRAFT', 'Hình ảnh đi kèm chưa khớp với tài liệu.')
            draft['images'] = [images[str(image.id)] for image in incoming.images]
            drafts.append(draft)
        excluded = list(db.scalars(select(Question.content).where(Question.question_bank_id == bank_id)))
        db.rollback()
        settings = get_settings()
        deadline = monotonic() + settings.QUESTION_GENERATION_TIMEOUT
        for offset in range(0, len(drafts), 5):
            group = drafts[offset:offset + 5]
            ids = {draft['source_chunk_id'] for draft in group}
            sources = storage.generation_sources(session, [source for source in session['chunks'] if source['id'] in ids])
            review_drafts(group, sources=sources, excluded=excluded + [draft['content'] for draft in drafts[:offset]], settings=settings, deadline=deadline)
        require_bank(db, bank_id, user)
        session['questions'] = drafts
        duplicate_flags(db, bank_id, drafts)
        storage.save_session(session)
        return ok(storage.public_session(session))


@router.post('/{bank_id}/documents/{document_id}/drafts/{draft_id}/regenerate')
def regenerate_draft(bank_id: UUID, document_id: UUID, draft_id: UUID,
                     db: Session = Depends(get_db), user: User = Depends(actor)):
    require_bank(db, bank_id, user)
    user_id = user.id
    with storage.document_session(document_id, bank_id, user_id) as session:
        require_editable(session)
        old = next((question for question in session['questions'] if question['id'] == str(draft_id)), None)
        if old is None or not session['config'] or session['config']['mode'] != 'generate':
            raise DocumentError('INVALID_DRAFT', 'Chỉ tạo lại được câu hỏi AI trong phiên hiện tại.')
        source = next((chunk for chunk in session['chunks'] if chunk['id'] == old['source_chunk_id']), None)
        if source is None:
            raise DocumentError('INVALID_DRAFT', 'Không tìm thấy phần nguồn của câu hỏi.')
        excluded = [question['content'] for question in session['questions']]
        db.rollback()
        replacements = measured_generation(db, user, session, storage.generation_sources(session, [source]),
            {source['id']: 1}, excluded, get_question_generation_provider(), replacement_id=draft_id)
        if not replacements:
            raise DocumentError('INVALID_GENERATION', 'Phần nguồn chưa đủ thông tin để tạo câu khác. Bản nháp hiện tại được giữ nguyên.')
        generated = replacements[0]
        generated['id'] = str(draft_id)
        require_bank(db, bank_id, user)
        session['questions'] = [generated if question['id'] == str(draft_id) else question for question in session['questions']]
        duplicate_flags(db, bank_id, session['questions'])
        storage.save_session(session)
        return ok(generated)


@router.post('/{bank_id}/documents/{document_id}/import')
def import_drafts(bank_id: UUID, document_id: UUID, payload: ImportDrafts,
                  db: Session = Depends(get_db), user: User = Depends(actor)):
    require_bank(db, bank_id, user)
    with storage.document_session(document_id, bank_id, user.id) as session:
        # New preview-only metadata must not change existing import receipts.
        digest = hashlib.sha256(payload.model_dump_json(exclude={'questions': {'__all__': {'quality_check'}}}).encode()).hexdigest()
        if session['imported']:
            if digest == session['imported']['digest']:
                return ok(session['imported']['result'])
            raise DocumentError('DOCUMENT_ALREADY_IMPORTED', 'Phiên tài liệu đã được nhập. Vui lòng tạo phiên mới.')
        # Completed drafts can be imported even when another batch failed. The
        # explicit confirmation closes the session; ImportDrafts still validates
        # every selected question, independently of optional quality feedback.
        if not session['config']:
            raise DocumentError('INVALID_DRAFT', 'Vui lòng tạo và kiểm tra bản nháp trước khi thêm vào ngân hàng.')
        known_ids = {question['id'] for question in session['questions']}
        if any(str(question.id) not in known_ids for question in payload.questions):
            raise DocumentError('INVALID_DRAFT', 'Một bản nháp không thuộc phiên tài liệu này.')
        originals = {question['id']: question for question in session['questions']}
        document_image_ids = {image['id'] for image in session.get('images', [])}
        for question in payload.questions:
            original = originals[str(question.id)]
            check = original.get('quality_check') or {}
            if ('POTENTIAL_DUPLICATE' in check.get('flags', []) and storage.normalized_content(question.content) == storage.normalized_content(original['content'])):
                raise DocumentError('DUPLICATE_QUESTIONS', 'Câu hỏi trùng nội dung đã được đánh dấu. Vui lòng sửa hoặc bỏ chọn câu trùng.')
            expected = {image['id'] for image in originals[str(question.id)].get('images', [])}
            selected_images = {str(image.id) for image in question.images}
            if not expected.issubset(selected_images) or not selected_images.issubset(document_image_ids) or len(question.images) != len(selected_images):
                raise DocumentError('INVALID_DRAFT', 'Hình ảnh đi kèm chưa khớp với câu hỏi đã review. Vui lòng tải lại phiên tài liệu.')
        normalized = [storage.normalized_content(question.content) for question in payload.questions]
        if len(set(normalized)) != len(normalized):
            raise DocumentError('DUPLICATE_QUESTIONS', 'Có câu hỏi trùng nhau trong danh sách chọn. Vui lòng sửa hoặc bỏ chọn câu trùng.')
        if any(near_duplicate(question.content, old.content) for index, question in enumerate(payload.questions) for old in payload.questions[:index]):
            raise DocumentError('DUPLICATE_QUESTIONS', 'Có câu hỏi gần trùng hoặc diễn đạt lại cùng nội dung. Vui lòng sửa hoặc bỏ chọn.')
        committed = False
        creating = False
        try:
            bank = require_bank(db, bank_id, user, lock=True)
            existing_rows = db.scalars(select(Question).where(Question.question_bank_id == bank_id)).all()
            by_id = {question.id: question for question in existing_rows}
            # Draft UUIDs become Question UUIDs. A retry after a commit/crash
            # cannot create a second copy even if the private result was not saved.
            already = [question for question in payload.questions if question.id in by_id]
            if already and len(already) != len(payload.questions):
                raise DocumentError('DOCUMENT_ALREADY_IMPORTED', 'Một phần của lượt nhập đã tồn tại. Vui lòng tải lại ngân hàng.')
            if not already and any(near_duplicate(question.content, row.content) for question in payload.questions for row in existing_rows):
                raise DocumentError('DUPLICATE_QUESTIONS', 'Một câu hỏi có thể đã tồn tại trong ngân hàng. Vui lòng sửa hoặc bỏ chọn trước khi thêm.')
            if already:
                committed = True
                for question in payload.questions:
                    row = by_id[question.id]
                    if any(getattr(row, key) != value for key, value in question.question_values().items()):
                        raise DocumentError('DOCUMENT_ALREADY_IMPORTED', 'Lượt nhập trước đã hoàn tất với nội dung khác. Vui lòng tải lại ngân hàng.')
                    if {image['id'] for image in row.images_json or []} != {str(image.id) for image in question.images}:
                        raise DocumentError('DOCUMENT_ALREADY_IMPORTED', 'Hình ảnh của lượt nhập trước khác với bản nháp hiện tại.')
            else:
                creating = True
                saved_images = attachments.persist_images(session, payload.questions)
                db.add_all(Question(question_bank_id=bank_id, images_json=saved_images[question.id], **question.question_values()) for question in payload.questions)
                bank.updated_at = datetime.now(timezone.utc)
                if session['config']['mode'] == 'generate':
                    record_audit(db, action='AI_QUESTION_IMPORTED', user_id=user.id, entity_type='question_bank', entity_id=bank_id,
                        metadata={'count': len(payload.questions)})
                db.commit()
                committed = True
            result = {'imported_count': len(payload.questions), 'question_ids': [str(question.id) for question in payload.questions]}
            # Drop all private document text immediately after successful import.
            session.update(imported={'digest': digest, 'result': result}, sections=[], chunks=[], questions=[], batches=[], images=[], preview_text='')
            storage.save_session(session)
            storage.remove_source(document_id)
            return ok(result)
        except SQLAlchemyError:
            db.rollback()
            raise DocumentError('IMPORT_FAILED', 'Chưa thêm được câu hỏi. Không có câu mới được lưu trong lượt này; vui lòng thử lại.') from None
        except OSError:
            db.rollback()
            message = ('Lượt nhập đã xử lý nhưng chưa ghi nhận được kết quả. Vui lòng tải lại ngân hàng trước khi thử lại.'
                       if committed else 'Chưa lưu được hình ảnh câu hỏi. Không có câu mới được thêm; vui lòng thử lại.')
            raise DocumentError('DOCUMENT_STORAGE_ERROR', message) from None
        except BaseException:
            db.rollback()
            raise
        finally:
            if creating and not committed:
                attachments.rollback_images(payload.questions)
