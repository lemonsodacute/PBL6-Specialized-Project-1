"""Private, expiring document sessions. Official questions are written only on import."""
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import json
import base64
import shutil
from pathlib import Path
import re
import unicodedata
from uuid import UUID, uuid4

from filelock import FileLock, Timeout

from app.schemas.question_documents import DraftQuestion
from app.services.question_document_extract import DocumentError, chunk_sections, QUESTION_START

DOCUMENT_ROOT = Path(__file__).resolve().parents[2] / 'private' / 'question-documents'
DOCUMENT_TTL = timedelta(hours=2)


def remove_source(document_id, *, root=None):
    root = root or DOCUMENT_ROOT
    name = str(UUID(str(document_id)))
    folder = root / name
    if folder.exists():
        if folder.resolve().parent != root.resolve():
            raise OSError('Invalid private source directory')
        shutil.rmtree(folder)


def source_image_path(session, image_id):
    name = str(UUID(str(image_id)))
    if not any(image['id'] == name for image in session.get('images', [])):
        raise DocumentError('DOCUMENT_NOT_FOUND', 'Không tìm thấy hình ảnh trong tài liệu.')
    return DOCUMENT_ROOT / str(UUID(session['id'])) / f'{name}.png'


def hydrate_images(session, drafts):
    images = {image['id']: image for image in session.get('images', [])}
    for draft in drafts:
        draft['images'] = [images[item['id']] for item in draft.get('images', []) if item['id'] in images]
    return drafts


def generation_sources(session, sources):
    by_id = {image['id']: image for image in session.get('images', [])}
    result = []
    for source in sources:
        images = []
        required_ids = source.get('image_ids', [])
        # Unpositioned PDF media remains page-local. A vision model may select
        # the relevant picture; a text-only model must never silently ignore it.
        candidate_ids = [image['id'] for image in session.get('images', [])
                         if image.get('page') is not None and image['page'] == source['page']
                         and image.get('position') is None]
        image_ids = list(dict.fromkeys(required_ids + candidate_ids))
        for image_id in image_ids:
            if image_id in by_id:
                try:
                    content = source_image_path(session, image_id).read_bytes()
                except OSError:
                    raise DocumentError('DOCUMENT_NOT_FOUND', 'Hình ảnh nguồn không còn khả dụng. Vui lòng tải lại tài liệu.') from None
                images.append({**by_id[image_id], 'data_base64': base64.b64encode(content).decode('ascii')})
        enriched = {**source, 'images': images, 'image_ids': image_ids,
                    'required_image_ids': required_ids, 'unassigned_page_image_ids': candidate_ids}
        if images and source.get('question_key') is not None:
            context = '\n'.join(section['text'] for section in session['sections']
                                if section.get('question_key') == source['question_key'] and section['text'])
            if len(context) > 16000:
                raise DocumentError('DOCUMENT_TOO_LONG', 'Một câu hỏi có hình ảnh quá dài để gửi đầy đủ cho AI. Vui lòng nhập và review câu hỏi có sẵn hoặc chia nhỏ tài liệu.')
            # Never separate the question's options from its visual evidence.
            enriched['question_context'] = context
        result.append(enriched)
    return result


def normalized_content(value: str) -> str:
    return ' '.join(unicodedata.normalize('NFKC', value).casefold().split())


def cleanup_expired(root=None):
    root = root or DOCUMENT_ROOT
    if not root.exists():
        return
    now = datetime.now(timezone.utc)
    for path in root.glob('*.json'):
        try:
            UUID(path.stem)
            data = json.loads(path.read_text(encoding='utf-8'))
            if datetime.fromisoformat(data['expires_at']) <= now:
                with FileLock(str(root / f'{path.stem}.lock'), timeout=0):
                    remove_source(path.stem, root=root)
                    path.unlink(missing_ok=True)
        except (OSError, ValueError, KeyError, Timeout):
            # Ignore files outside the valid session contract.
            continue
    # Clean images from a crash before the atomic session receipt was written.
    for folder in root.iterdir():
        if folder.is_dir():
            try:
                UUID(folder.name)
                if not (root / f'{folder.name}.json').exists() and now.timestamp() - folder.stat().st_mtime >= DOCUMENT_TTL.total_seconds():
                    remove_source(folder.name, root=root)
            except (OSError, ValueError):
                continue
    # Atomic writes normally remove temp files in finally; also clean up a
    # write interrupted by a process crash without retaining its source text.
    for path in root.glob('*.tmp'):
        try:
            session_id, nonce, suffix = path.name.rsplit('.', 2)
            UUID(session_id)
            if len(nonce) == 32 and suffix == 'tmp' and now.timestamp() - path.stat().st_mtime >= DOCUMENT_TTL.total_seconds():
                path.unlink(missing_ok=True)
        except (OSError, ValueError):
            continue


def save_session(session):
    DOCUMENT_ROOT.mkdir(parents=True, exist_ok=True)
    name = str(UUID(session['id']))
    path = DOCUMENT_ROOT / f'{name}.json'
    temporary = DOCUMENT_ROOT / f'{name}.{uuid4().hex}.tmp'
    try:
        temporary.write_text(json.dumps(session, ensure_ascii=False), encoding='utf-8')
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def new_session(bank_id, user_id, filename, extracted):
    cleanup_expired()
    now = datetime.now(timezone.utc)
    session = {'id': str(uuid4()), 'bank_id': str(bank_id), 'user_id': str(user_id),
        'filename': Path(filename.replace('\\', '/')).name[:255],
        'expires_at': (now + DOCUMENT_TTL).isoformat(), 'sections': extracted['sections'],
        'chunks': chunk_sections(extracted['sections']), 'warnings': extracted['warnings'],
        'character_count': extracted['character_count'], 'questions': [], 'batches': [],
        'config': None, 'imported': None}
    session.update(file_type=extracted.get('file_type', Path(filename).suffix.lstrip('.').lower()),
                   page_count=extracted.get('page_count'), page_count_estimated=extracted.get('page_count_estimated', False),
                   image_count=extracted.get('image_count', 0), images=[], structure_parsed=True)
    source_text = '\n'.join(section['text'] for section in session['sections'] if section['text'])
    first_question, offset = 0, 0
    for line in source_text.splitlines(keepends=True):
        if QUESTION_START.match(line.strip()) and re.match(r'^\s*(?:Câu|Question)', line, re.I):
            first_question = offset; break
        offset += len(line)
    preview = source_text[first_question:first_question + 1000]
    if len(preview) == 1000 and '\n' in preview[500:]:
        preview = preview[:preview.rfind('\n')]
    session['preview_text'] = preview
    blocks = existing_question_blocks(session['sections'])
    session['structured_question_count'] = len(blocks) if blocks else None
    try:
        for extracted_image in extracted.get('images', []):
            image = {key: value for key, value in extracted_image.items() if key != 'data_base64'}
            image['temp_url'] = f"/question-banks/{bank_id}/documents/{session['id']}/images/{image['id']}"
            session['images'].append(image)
            path = source_image_path(session, image['id'])
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(base64.b64decode(extracted_image['data_base64'], validate=True))
        save_session(session)
    except BaseException:
        remove_source(session['id'])
        raise
    return session


@contextmanager
def document_session(document_id: UUID, bank_id, user_id):
    cleanup_expired()
    name = str(document_id)
    DOCUMENT_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        lock = FileLock(str(DOCUMENT_ROOT / f'{name}.lock'), timeout=0.5)
        lock.acquire()
    except Timeout:
        raise DocumentError('DOCUMENT_BUSY', 'Tài liệu đang được xử lý. Vui lòng đợi rồi thử lại.') from None
    try:
        path = DOCUMENT_ROOT / f'{name}.json'
        try:
            session = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            raise DocumentError('DOCUMENT_NOT_FOUND', 'Phiên tài liệu không còn khả dụng. Vui lòng tải lại file.') from None
        if session['bank_id'] != str(bank_id) or session['user_id'] != str(user_id):
            raise DocumentError('DOCUMENT_NOT_FOUND', 'Không tìm thấy phiên tài liệu.')
        if datetime.fromisoformat(session['expires_at']) <= datetime.now(timezone.utc):
            remove_source(document_id)
            path.unlink(missing_ok=True)
            raise DocumentError('DOCUMENT_EXPIRED', 'Phiên tài liệu đã hết hạn. Vui lòng tải lại file.')
        yield session
    finally:
        lock.release()


def public_session(session, *, include_text=False):
    result = {key: session[key] for key in ('id', 'filename', 'expires_at', 'warnings', 'character_count', 'questions')}
    result['batches'] = [{'index': index, 'count': batch['count'], 'complete': batch['complete'],
                          'error': batch.get('error'), 'generated_count': batch.get('generated_count'),
                          'quality_summary': batch.get('quality_summary')}
                         for index, batch in enumerate(session['batches'])]
    if (session.get('config') or {}).get('mode') == 'generate' and (any(draft.get('quality_check') for draft in session['questions']) or any(batch.get('quality_summary') for batch in session['batches'])):
        from app.services.question_quality import summarize
        summaries = [batch.get('quality_summary') or {} for batch in session['batches']]
        result['quality_summary'] = summarize(session['questions'], generated=max(len(session['questions']), sum(value.get('generated', 0) for value in summaries)),
            rejected=sum(value.get('rejected', 0) for value in summaries),
            planned_sources={source for batch in session['batches'] for source in batch.get('requirements', {})})
        for key in ('duplicate', 'unsupported', 'ambiguous'):
            result['quality_summary'][key] += sum(value.get('rejected_reasons', {}).get(key, 0) for value in summaries)
    result['config'] = session['config']
    result['imported_count'] = session['imported']['result']['imported_count'] if session['imported'] else None
    for key in ('file_type', 'page_count', 'page_count_estimated', 'image_count', 'images', 'preview_text',
                'structured_question_count', 'structure_parsed'):
        result[key] = session.get(key)
    if include_text:
        result['sections'] = session['sections']
    return result


def existing_question_blocks(sections):
    start = QUESTION_START
    option = re.compile(r'^\s*([A-L])[.):]\s*(.*)$', re.I)
    answer = re.compile(r'^\s*(?:Đáp\s*án(?:\s*đúng)?|Answer|Correct\s*answer)\s*[:\-]\s*(.*)$', re.I)
    explanation = re.compile(r'^\s*(?:Giải\s*thích|Explanation)\s*[:\-]\s*(.*)$', re.I)
    blocks, current = [], None
    for section in sections:
        for line in section['text'].splitlines():
            heading = start.match(line)
            if heading:
                if current:
                    blocks.append(current)
                current = {'content': [heading[2]], 'options': {}, 'answer': '', 'explanation': [],
                           'source': section, 'last': 'content', 'image_ids': [], 'excerpt': [line],
                           'explicit_heading': bool(re.match(r'^\s*(?:Câu|Question)', line, re.I))}
                continue
            if current is None or not line.strip():
                continue
            current['excerpt'].append(line)
            matched = option.match(line)
            matched_answer = answer.match(line)
            matched_explanation = explanation.match(line)
            if matched_answer:
                current['answer'] = matched_answer[1].strip(); current['last'] = 'answer'
            elif matched_explanation:
                current['explanation'].append(matched_explanation[1]); current['last'] = 'explanation'
            elif matched:
                key = matched[1].upper()
                current['options'][key] = matched[2].strip(); current['last'] = key
            elif current['last'] in current['options']:
                key = current['last']; current['options'][key] += ' ' + line.strip()
            elif current['last'] == 'answer':
                current['answer'] += ' ' + line.strip()
            else:
                key = 'explanation' if current['last'] == 'explanation' else 'content'
                current[key].append(line.strip())
        if current and section.get('image_ids') and not (section.get('position') or {}).get('association_unknown'):
            current['image_ids'].extend(section['image_ids'])
    if current:
        blocks.append(current)
    return [block for block in blocks if block['options'] or block['answer'] or block['explicit_heading']]


def parse_existing_questions(sections, *, topic=None, images=None):
    blocks = existing_question_blocks(sections)
    by_id = {image['id']: image for image in images or []}
    if not blocks:
        raise DocumentError('NO_IMPORTABLE_QUESTIONS', 'Chưa tìm thấy câu hỏi có sẵn. Dùng dạng “Câu 1: …”, phương án A/B/C/D và “Đáp án: …”, hoặc chọn tạo từ nội dung.')
    if len(blocks) > 100:
        raise DocumentError('TOO_MANY_DRAFTS', 'Chỉ nhập tối đa 100 câu mỗi lần. Vui lòng tách tài liệu.')
    drafts = []
    for block in blocks:
        content = '\n'.join(block['content']).strip()
        options = block['options']
        answer_text = block['answer']
        answers = [value for value in options.values() if normalized_content(value) == normalized_content(answer_text)] if answer_text else []
        # Accept explicit option labels, never guess letters inside prose.
        if options and not answers and re.fullmatch(r'[A-L](?:\s*(?:[,;/+&]|\band\b|\bvà\b|\s)\s*[A-L])*\.?', answer_text, re.I):
            labels = re.split(r'\s*(?:[,;/+&]|\band\b|\bvà\b|\s+)\s*', answer_text.rstrip('.'), flags=re.I)
            if all(label.upper() in options for label in labels):
                answers = [options[label.upper()] for label in dict.fromkeys(labels)]
        if not options and block['answer']:
            answers = [block['answer']]
        draft = DraftQuestion(id=uuid4(), content=content, type='mcq_multi' if options and len(answers) > 1 else 'mcq_single' if options else 'essay',
            topic=topic, options=list(options.values()), answers=answers, explanation='\n'.join(block['explanation']),
            source_page=block['source']['page'], source_section=block['source']['label'],
            source_excerpt='\n'.join(block['excerpt'])[:6000],
            images=[by_id[image_id] for image_id in dict.fromkeys(block['image_ids']) if image_id in by_id])
        draft.warnings = draft.problems()
        drafts.append(draft.model_dump(mode='json'))
    return drafts


def generation_plan(chunks: list[dict], count: int) -> list[dict]:
    # Stratified indices include both ends of a long document. Every request
    # sees at most five 2400-character chunks, never the whole document.
    chunks = [chunk for chunk in chunks if len(normalized_content(chunk['text'])) >= 10]
    # A title page is not an assessable source. Keep actual numbered questions
    # and image sources, including short questions; omit multi-line cover headings.
    def cover_heading(chunk):
        lines = [line.strip() for line in chunk['text'].splitlines() if line.strip()]
        return (not chunk.get('question_number') and not chunk.get('image_ids') and len(lines) >= 3
            and all(line.isupper() and len(line.split()) <= 20 for line in lines))
    chunks = [chunk for chunk in chunks if not cover_heading(chunk)]
    if not chunks:
        raise DocumentError('DOCUMENT_HAS_TOO_LITTLE_TEXT', 'Tài liệu chưa có đủ nội dung để tạo câu hỏi có nguồn. Vui lòng tải tài liệu đầy đủ hơn.')
    used = min(len(chunks), count)
    indices = [round(index * (len(chunks) - 1) / (used - 1)) for index in range(used)] if used > 1 else [len(chunks) // 2]
    allocations = [indices[index % used] for index in range(count)]
    batches = []
    for offset in range(0, count, 5):
        group = allocations[offset:offset + 5]
        requirements = Counter(chunks[index]['id'] for index in group)
        batches.append({'count': len(group), 'sources': [chunks[index] for index in dict.fromkeys(group)],
                        'requirements': dict(requirements), 'complete': False})
    return batches
