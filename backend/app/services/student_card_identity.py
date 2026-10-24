"""Card orchestration. Inference precedes the short, user-locked commit."""
from datetime import datetime, timezone
import hashlib
from io import BytesIO
from uuid import uuid4

from PIL import Image
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.models.entities import StudentCardPreview, StudentCardReference, StudentFaceEmbedding, User
from app.services.face_embeddings import FaceEmbeddingError, get_face_embedding, save_face_embedding
from app.services.face_recognition import get_face_engine
from app.services.student_card_matching import MATCHING_VERSION, PARSER_VERSION, compare_fields, normalize_code, normalize_name, parse_fields
from app.services.student_card_ocr import MODEL_VERSION, OCRError, ocr
from app.services import student_card_previews as previews
from app.services.student_identity_profile import lock_user, validate_student_code
from app.services.student_card_admin import audit_card, latest_reference, notify_card
from app.services.profile_avatar import sync_card_avatar
from app.services.student_card_class import class_preview_metadata
from app.services.audit import record_audit


def active_reference(db, user):
    if user.identity_profile_status != 'VERIFIED' or not user.is_active or not user.student_code or user.student_card_status != 'VERIFIED':
        return None
    return db.scalar(select(StudentCardReference).join(StudentFaceEmbedding,
        StudentFaceEmbedding.reference_version == StudentCardReference.id).where(
        StudentCardReference.student_id == user.id, StudentFaceEmbedding.student_id == user.id,
        StudentCardReference.status == 'ACTIVE', StudentCardReference.identity_profile_version == user.identity_profile_version
    ).execution_options(populate_existing=True))


def require_reference(db, user):
    previews.require_profile(user)
    reference = active_reference(db, user)
    if reference is None:
        raise previews.preview_error('REFERENCE_REQUIRED', 'Bạn chưa thiết lập ảnh định danh. Vui lòng cập nhật ảnh thẻ sinh viên trong Hồ sơ trước khi tham gia bài thi.')
    return reference


def reference_status(db, user):
    reference = active_reference(db, user)
    latest = reference or latest_reference(db, user.id)
    return {'identity_profile_status': user.identity_profile_status, 'student_card_status': preview_card_status(db, user),
            'has_reference': reference is not None, 'reference_version': str(reference.id) if reference else None,
            'reference_status': latest.status if latest else None,
            'update_requested': user.card_last_action == 'CARD_UPDATE_REQUESTED',
            'update_reason': user.card_update_reason, 'card_admin_version': user.card_admin_version,
            'was_revoked': user.card_last_action == 'CARD_REVOKED',
            'updated_at': reference.created_at.isoformat() if reference else None}


def preview_card_status(db, user):
    if user.student_card_status == 'NOT_SUBMITTED' and db.scalar(select(StudentCardPreview.id).where(
            StudentCardPreview.student_id == user.id, StudentCardPreview.status == 'PENDING',
            StudentCardPreview.expires_at > datetime.now(timezone.utc),
            StudentCardPreview.identity_profile_version == user.identity_profile_version,
            StudentCardPreview.card_admin_version == user.card_admin_version).limit(1)):
        return 'PENDING_CONFIRMATION'
    return user.student_card_status


def read_card_fields(content):
    try:
        lines = ocr.recognize(content)
    except OCRError as exc:
        raise previews.preview_error(exc.code, 'Chưa đọc được thông tin thẻ. Vui lòng thử lại với ảnh rõ nét.',
                                     503 if exc.code == 'MODEL_ERROR' else 422) from None
    extracted, confidence = parse_fields(lines)
    extracted['ocr_display_name'] = extracted.get('full_name')
    extracted.update(class_preview_metadata(extracted, confidence))
    return extracted, confidence


def create_card_preview(db, user, content, content_type):
    previews.require_profile(user)
    user_id, version = user.id, user.identity_profile_version
    admin_version = user.card_admin_version
    name, code = user.full_name, user.student_code
    db.rollback()  # Never hold a DB transaction during OCR/DNN work.
    try:
        with Image.open(BytesIO(content)) as source:
            expected = {'image/jpeg': 'JPEG', 'image/png': 'PNG'}.get(content_type)
            if expected is None or source.format != expected:
                raise ValueError('Unsupported image')
    except (OSError, ValueError, Image.DecompressionBombError):
        raise previews.preview_error('INVALID_IMAGE', 'Vui lòng dùng ảnh JPG hoặc PNG hợp lệ.', 422) from None
    card, face = get_face_engine().prepare_card(content)
    extracted, confidence = read_card_fields(content)
    validation = compare_fields(extracted, confidence, name, code, allow_missing_student_code=True)
    row = previews.create_preview(db, user_id, version, original=content, card=card, face=face,
        extracted=extracted, confidence=confidence, validation=validation, ocr_model_version=MODEL_VERSION,
        parser_version=PARSER_VERSION, matching_version=MATCHING_VERSION, expected_admin_version=admin_version)
    prefix = f'/api/v1/identity/student-card/previews/{row.id}'
    return {'preview_id': str(row.id), 'expires_at': row.expires_at.isoformat(),
            'card_preview_url': prefix + '/card', 'face_preview_url': prefix + '/face',
            'extracted': row.extracted_json, **validation}


def _recheck(row, user, *, extracted=None, confidence=None):
    if (row.parser_version != PARSER_VERSION or row.matching_version != MATCHING_VERSION or row.ocr_model_version != MODEL_VERSION):
        raise previews.preview_error('PREVIEW_SUPERSEDED', 'Bản xem trước cần được tạo lại.')
    result = compare_fields(extracted if extracted is not None else row.extracted_json,
                            confidence if confidence is not None else row.confidence_json or {},
                            user.full_name, user.student_code, allow_missing_student_code=True)
    if not result['can_confirm']:
        code = result['blocking_errors'][0]
        message = {'STUDENT_CODE_UNREADABLE': 'Chưa đọc rõ mã sinh viên. Vui lòng tải ảnh rõ nét hơn.',
                   'NAME_UNREADABLE': 'Chưa đọc rõ họ tên. Vui lòng tải ảnh rõ nét hơn.',
                   'NAME_LOW_CONFIDENCE': 'Đã đọc được họ tên nhưng độ tin cậy chưa đủ. Vui lòng tải ảnh rõ nét hơn.'}.get(
                       code, 'Thông tin thẻ chưa khớp với hồ sơ. Vui lòng tải ảnh khác.')
        if code == 'STUDENT_CODE_MISMATCH':
            message = 'MSSV trên thẻ không khớp với hồ sơ. Vui lòng liên hệ quản trị viên.'
        raise previews.preview_error(code, message, 422)


def confirm_card(db, user, preview_id):
    row = previews.load_preview(db, preview_id, user)
    _recheck(row, user)
    user_id, version = user.id, user.identity_profile_version
    admin_version = user.card_admin_version
    original_key, digest = row.original_image_key, row.image_sha256
    if original_key != f'{preview_id.hex}/original.bin':
        raise previews.preview_error('PREVIEW_NOT_FOUND', 'Không tìm thấy bản xem trước.', 404)
    try:
        content = previews.private_path(original_key).read_bytes()
        face = previews.read_image(row, 'face')
    except OSError:
        raise previews.preview_error('PREVIEW_NOT_FOUND', 'Không tìm thấy bản xem trước.', 404) from None
    if hashlib.sha256(content).hexdigest() != digest:
        raise previews.preview_error('INVALID_IMAGE', 'Ảnh xem trước đã thay đổi. Vui lòng tải lại.', 422)
    db.rollback()
    extracted, confidence = read_card_fields(content)
    embedding = get_face_engine().extract_embedding(content, mode='card')
    try:
        current = lock_user(db, user_id)
        if current.identity_profile_version != version or current.card_admin_version != admin_version:
            raise previews.preview_error('PROFILE_CHANGED', 'Hồ sơ đã thay đổi. Vui lòng tải lại ảnh thẻ.')
        row = previews.load_preview(db, preview_id, current)
        _recheck(row, current)
        _recheck(row, current, extracted=extracted, confidence=confidence)
        if row.image_sha256 != digest or row.original_image_key != original_key:
            raise previews.preview_error('INVALID_IMAGE', 'Ảnh xem trước đã thay đổi.', 422)
        seen = row.extracted_json
        if (normalize_code(seen.get('student_code')) != normalize_code(extracted.get('student_code'))
                or normalize_name(seen.get('full_name')) != normalize_name(extracted.get('full_name'))
                or (seen.get('class_name') and extracted.get('class_name') and seen['class_name'] != extracted['class_name'])):
            raise previews.preview_error('PREVIEW_SUPERSEDED', 'Thông tin OCR đã thay đổi. Vui lòng tải lại ảnh thẻ và xác nhận lại.')
        changed = []
        if not normalize_code(current.student_code):
            code = normalize_code(extracted['student_code'])
            validate_student_code(db, current.role, code, current.id)
            current.student_code = code
            current.identity_profile_version += 1
            changed.append('student_code')
        if extracted.get('class_name') and extracted['class_name'] != current.class_name:
            current.class_name = extracted['class_name']
            changed.append('class_name')
        if changed:
            current.updated_at = datetime.now(timezone.utc)
        previous = latest_reference(db, user_id)
        db.execute(update(StudentCardReference).where(StudentCardReference.student_id == user_id,
            StudentCardReference.status == 'ACTIVE').values(status='SUPERSEDED', sanitized_face=None))
        reference = StudentCardReference(id=uuid4(), student_id=user_id, identity_profile_version=current.identity_profile_version,
            status='ACTIVE', created_at=datetime.now(timezone.utc), sanitized_face=face,
            verified_by_user_id=current.id, verified_by_role=current.role.value, verification_source='STUDENT_SELF_CONFIRM',
            ocr_model_version=row.ocr_model_version, parser_version=row.parser_version, matching_version=row.matching_version)
        db.add(reference)
        db.flush()
        stored = save_face_embedding(db, user_id, embedding)
        stored.reference_version = reference.id
        reference.face_model_name = stored.model_name
        reference.face_model_version = stored.model_version
        reference.face_preprocessing_version = stored.preprocessing_version
        row.status = 'CONFIRMED'
        row.extracted_json, row.confidence_json = extracted, confidence
        current.student_card_status = 'VERIFIED'
        current.card_update_reason = None
        current.card_last_action = 'CARD_VERIFIED'
        current.card_admin_version += 1
        audit_card(db, 'CARD_VERIFIED', current, current.id, reference.id)
        audit_card(db, 'STUDENT_CARD_CONFIRMED', current, current.id, reference.id)
        if changed:
            record_audit(db, action='PROFILE_UPDATED_FROM_STUDENT_CARD', user_id=current.id,
                         entity_type='user', entity_id=current.id,
                         metadata={'fields_changed': changed, 'reference_id': str(reference.id)})
        if previous:
            audit_card(db, 'CARD_REPLACED', current, current.id, reference.id, previous_reference_id=str(previous.id))
        notify_card(db, current, current, 'Đã xác thực thẻ sinh viên', 'Bạn đã xác nhận thẻ sinh viên mới thành công.', reference.id)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        constraint = getattr(getattr(exc.orig, 'diag', None), 'constraint_name', None)
        if constraint == 'uq_users_student_code' or 'UNIQUE constraint failed: users.student_code' in str(exc.orig):
            raise previews.preview_error('STUDENT_CODE_EXISTS', 'MSSV trên thẻ đã thuộc hồ sơ khác. Vui lòng liên hệ quản trị viên.', 409) from None
        raise previews.preview_error('REFERENCE_SAVE_FAILED', 'Chưa lưu được ảnh định danh. Vui lòng thử lại.', 503) from None
    except (SQLAlchemyError, FaceEmbeddingError):
        db.rollback()
        raise previews.preview_error('REFERENCE_SAVE_FAILED', 'Chưa lưu được ảnh định danh. Vui lòng thử lại.', 503) from None
    except BaseException:
        db.rollback()
        raise
    previews._try_remove(preview_id)
    sync_card_avatar(db, user_id, reference.id)
    return reference_status(db, current)
