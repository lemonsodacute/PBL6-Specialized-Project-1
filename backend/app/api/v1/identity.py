from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4
import logging
import hashlib

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.deps import roles
from app.api.responses import ok
from app.core.database import get_db
from app.models.entities import ClassEnrollment, Exam, ExamAssignment, IdentityVerification, StudentIdentity, StudentCardPreview, StudentCardReference, User, UserRole
from app.services.face_recognition import MAX_IMAGE_BYTES, face_error, get_face_engine, match_threshold
from app.services.student_card_identity import active_reference, require_reference, reference_status
from app.services.student_identity_profile import lock_user
from app.services.exam_entry import ENTRY_PURPOSE, ENTRY_MISMATCH, ENTRY_FACE_ERRORS
from app.services.student_card_previews import utc
from app.services.face_embeddings import FaceEmbeddingError, get_face_embedding, delete_face_embedding
from app.services.student_card_previews import _try_remove
from sqlalchemy.exc import SQLAlchemyError

router = APIRouter()
# Biometric images must never be served by the public /uploads mount.
IDENTITY_DIR = Path(__file__).resolve().parents[3] / 'private' / 'identity'
LEGACY_DIR = Path(__file__).resolve().parents[3] / 'uploads' / 'identity'
VERIFICATION_TTL = timedelta(minutes=15)
logger = logging.getLogger(__name__)


def _serialize(identity: StudentIdentity | None) -> dict:
    return {
        'enrolled': identity is not None,
        'status': identity.status if identity else 'not_enrolled',
        'updated_at': identity.updated_at.isoformat() if identity else None,
    }


async def _read_image(upload: UploadFile) -> bytes:
    if upload.content_type not in {'image/jpeg', 'image/png', 'image/webp'}:
        raise face_error('INVALID_IMAGE_TYPE', 'Ảnh nhận diện phải là JPEG, PNG hoặc WEBP.')
    content = await upload.read(MAX_IMAGE_BYTES + 1)
    if len(content) > MAX_IMAGE_BYTES:
        raise face_error('IMAGE_TOO_LARGE', 'Ảnh nhận diện không được vượt quá 8 MB.', 413)
    return content


def _image_path(value: str | None) -> Path | None:
    if not value:
        return None
    for prefix, directory in (('/private/identity/', IDENTITY_DIR), ('/uploads/identity/', LEGACY_DIR)):
        if value.startswith(prefix):
            name = value[len(prefix):]
            if name and Path(name).name == name and '/' not in name and '\\' not in name and name not in {'.', '..'}:
                return directory / name
    return None


def _save_image(content: bytes) -> str:
    IDENTITY_DIR.mkdir(parents=True, exist_ok=True)
    name = f'{uuid4().hex}.jpg'
    path = IDENTITY_DIR / name
    try:
        path.write_bytes(content)
    except OSError:
        path.unlink(missing_ok=True)
        raise
    return f'/private/identity/{name}'


def _remove_image(value: str | None) -> None:
    path = _image_path(value)
    if path:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logger.exception('Unable to remove an identity image')


def _require_identity(db: Session, user: User) -> StudentIdentity:
    identity = db.scalar(select(StudentIdentity).where(StudentIdentity.student_id == user.id).with_for_update())
    if identity is None:
        raise face_error('IDENTITY_NOT_ENROLLED', 'Bạn chưa đăng ký khuôn mặt. Hãy đăng ký trước khi xác minh.', 409)
    return identity


def _compare(identity: StudentIdentity, content: bytes) -> tuple[dict, bytes]:
    engine = get_face_engine()
    feature, clean_image = engine.extract(content)
    references = []
    for value in (identity.front_image_path, identity.left_image_path, identity.right_image_path):
        path = _image_path(value)
        if path is None or not path.is_file():
            raise face_error('IDENTITY_INCOMPLETE', 'Ảnh đăng ký không còn đầy đủ. Vui lòng đăng ký lại khuôn mặt.', 409)
        try:
            reference = engine.extract_embedding(path.read_bytes())
        except OSError as exc:
            raise face_error('IDENTITY_INCOMPLETE', 'Không đọc được ảnh đăng ký. Vui lòng đăng ký lại khuôn mặt.', 409) from exc
        references.append(reference)
    # Require agreement with at least two enrollment views, not a single outlier.
    score = sorted(engine.compare_embeddings(feature, reference) for reference in references)[1]
    threshold = match_threshold()
    verified = score >= threshold
    return {
        'verified': verified, 'status': 'verified' if verified else 'rejected',
        'score': round(score, 4), 'threshold': threshold, 'liveness_checked': False,
        'message': 'Khuôn mặt khớp với dữ liệu đã đăng ký.' if verified else 'Khuôn mặt chưa khớp. Hãy nhìn thẳng, kiểm tra ánh sáng và thử lại.',
    }, clean_image


def _require_exam(db: Session, exam_id: UUID, user: User) -> Exam:
    exam = db.get(Exam, exam_id)
    assigned = db.scalar(select(ExamAssignment.id).where(
        ExamAssignment.exam_id == exam_id,
        or_(ExamAssignment.student_id == user.id, ExamAssignment.class_id.in_(
            select(ClassEnrollment.class_id).where(ClassEnrollment.student_id == user.id)
        )),
    ).limit(1))
    if exam is None or exam.deleted_at is not None or assigned is None:
        raise face_error('EXAM_NOT_FOUND', 'Không tìm thấy bài thi được giao cho bạn.', 404)
    return exam


def verification_is_current(verification, reference, now: datetime) -> bool:
    """Only the caller's current card reference can authorize a new attempt."""
    if verification is None or reference is None or verification.status != 'verified':
        return False
    if not verification.reference_version or verification.reference_version != reference.id or reference.status != 'ACTIVE':
        return False
    created = utc(verification.created_at)
    return utc(reference.created_at) <= created <= now and now - created <= VERIFICATION_TTL


@router.get('/status')
def status(db: Session = Depends(get_db), user: User = Depends(roles(UserRole.student))):
    state = reference_status(db, user)
    return ok({**state, 'enrolled': state['has_reference'], 'status': 'verified' if state['has_reference'] else 'not_enrolled'})


async def _legacy_enroll(front, left, right, consent, db, user):
    """Historical implementation retained for later cleanup; not an API route."""
    if not consent:
        raise face_error('CONSENT_REQUIRED', 'Cần xác nhận đồng ý trước khi đăng ký nhận diện.')
    engine = await run_in_threadpool(get_face_engine)
    samples = []
    for label, upload in (('Nhìn thẳng', front), ('Quay trái', left), ('Quay phải', right)):
        try:
            samples.append(await run_in_threadpool(engine.extract, await _read_image(upload)))
        except HTTPException as exc:
            if isinstance(exc.detail, dict):
                exc.detail['message'] = f"{label}: {exc.detail['message']}"
            raise
    if any(engine.compare_embeddings(samples[0][0], sample[0]) < match_threshold() for sample in samples[1:]):
        raise face_error('ENROLLMENT_FACE_MISMATCH', 'Ba ảnh phải là cùng một người. Hãy quay đầu nhẹ và chụp lại.')
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    identity = db.scalar(select(StudentIdentity).where(StudentIdentity.student_id == user.id).with_for_update())
    old_paths = (identity.front_image_path, identity.left_image_path, identity.right_image_path) if identity else ()
    paths = []
    try:
        for _, clean_image in samples:
            paths.append(_save_image(clean_image))
        if identity is None:
            identity = StudentIdentity(student_id=user.id)
            db.add(identity)
        identity.front_image_path, identity.left_image_path, identity.right_image_path = paths
        identity.status = 'verified'
        identity.consented_at = identity.updated_at = datetime.now(timezone.utc)
        db.commit()
    except Exception:
        db.rollback()
        for path in paths:
            _remove_image(path)
        raise
    for path in old_paths:
        _remove_image(path)
    return ok(_serialize(identity))


async def _legacy_check(image, consent, db, user):
    """Historical implementation retained for later cleanup; not an API route."""
    if not consent:
        raise face_error('CONSENT_REQUIRED', 'Vui lòng đồng ý đối chiếu khuôn mặt.')
    identity = _require_identity(db, user)
    result, _ = await run_in_threadpool(_compare, identity, await _read_image(image))
    return ok(result)


@router.post('/enroll', deprecated=True)
@router.post('/check', deprecated=True)
async def legacy_unavailable(user: User = Depends(roles(UserRole.student))):
    raise face_error('LEGACY_IDENTITY_DEPRECATED', 'Vui lòng tải và xác nhận ảnh thẻ sinh viên trong Hồ sơ.', 410)


@router.post('/exams/{exam_id}/verify')
async def verify(exam_id: UUID, image: UploadFile = File(...), consent: bool = Form(...), db: Session = Depends(get_db), user: User = Depends(roles(UserRole.student))):
    return await _verify(exam_id, image, consent, db, user)


@router.post('/exams/{exam_id}/verify-entry')
async def verify_entry(exam_id: UUID, image: UploadFile = File(...), consent: bool = Form(...), db: Session = Depends(get_db), user: User = Depends(roles(UserRole.student))):
    return await _verify(exam_id, image, consent, db, user, final_entry=True)


async def _verify(exam_id, image, consent, db, user, *, final_entry=False):
    if not consent:
        raise face_error('CONSENT_REQUIRED', 'Vui lòng đồng ý xác minh khuôn mặt cho bài thi này.')
    _require_exam(db, exam_id, user)
    user_id = user.id
    current = lock_user(db, user_id)
    reference = require_reference(db, current)
    version, profile_version = reference.id, current.identity_profile_version
    try:
        template = get_face_embedding(db, user_id)
    except FaceEmbeddingError:
        db.rollback()
        raise face_error('MODEL_ERROR', 'Ảnh định danh chưa sẵn sàng. Vui lòng cập nhật trong Hồ sơ.', 503) from None
    if final_entry:
        # A new final check invalidates earlier unused proofs, even if this frame fails.
        db.execute(update(IdentityVerification).where(
            IdentityVerification.student_id == user_id, IdentityVerification.exam_id == exam_id,
            IdentityVerification.liveness_json['purpose'].astext == ENTRY_PURPOSE,
            IdentityVerification.status == 'verified',
        ).values(status='superseded'))
        db.commit()
    else:
        db.rollback()
    # DNN inference must not hold user/exam locks.
    content = await _read_image(image)
    received_at = datetime.now(timezone.utc)
    frame_hash = hashlib.sha256(content).hexdigest()
    engine = await run_in_threadpool(get_face_engine)
    try:
        probe = await run_in_threadpool(engine.extract_embedding, content)
    except HTTPException as exc:
        if final_entry and isinstance(exc.detail, dict) and exc.detail.get('code') in ENTRY_FACE_ERRORS:
            exc.detail = {**exc.detail, 'message': ENTRY_FACE_ERRORS[exc.detail['code']]}
        raise
    score = engine.compare_embeddings(probe, template)
    threshold = match_threshold()
    verified = score >= threshold
    result = {'verified': verified, 'status': 'verified' if verified else 'rejected',
              'score': round(score, 4), 'threshold': threshold, 'liveness_checked': False,
              'message': 'Xác minh danh tính thành công. Bạn có thể bắt đầu bài thi.' if verified else ENTRY_MISMATCH if final_entry else 'Khuôn mặt chưa khớp. Hãy kiểm tra ánh sáng và thử lại.'}
    try:
        # Consistent lock order with attempts.start: exam, then student.
        db.scalar(select(Exam).where(Exam.id == exam_id).with_for_update())
        current = lock_user(db, user_id)
        _require_exam(db, exam_id, current)
        reference = require_reference(db, current)
        if reference.id != version or current.identity_profile_version != profile_version:
            raise face_error('REFERENCE_CHANGED', 'Ảnh định danh đã thay đổi. Vui lòng xác minh lại.', 409)
        if final_entry and db.scalar(select(IdentityVerification.id).where(
            IdentityVerification.student_id == user_id, IdentityVerification.exam_id == exam_id,
            IdentityVerification.liveness_json['frame_sha256'].astext == frame_hash,
        ).limit(1)) is not None:
            raise face_error('FRESH_FRAME_REQUIRED', 'Vui lòng chụp ảnh camera mới để xác minh lại.', 409)
        metadata = {'checked': False, 'frame_sha256': frame_hash}
        if final_entry:
            metadata.update(purpose=ENTRY_PURPOSE, frame_received_at=received_at.isoformat(), profile_version=profile_version)
        verification = IdentityVerification(student_id=user_id, exam_id=exam_id, reference_version=version,
            image_path=None, liveness_json=metadata, status=result['status'], score=result['score'],
            failure_reason=None if verified else 'FACE_MISMATCH', created_at=datetime.now(timezone.utc))
        db.add(verification)
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise face_error('VERIFICATION_SAVE_FAILED', 'Chưa lưu được kết quả xác minh. Vui lòng thử lại.', 503) from None
    except BaseException:
        db.rollback()
        raise
    return ok({**result, 'id': str(verification.id), 'reference_version': str(version)})


@router.get('/exams/{exam_id}/status')
def exam_status(exam_id: UUID, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.student))):
    _require_exam(db, exam_id, user)
    verification = db.scalar(select(IdentityVerification).where(IdentityVerification.exam_id == exam_id, IdentityVerification.student_id == user.id).order_by(IdentityVerification.created_at.desc()).limit(1))
    reference = active_reference(db, user)
    verified = verification_is_current(verification, reference, datetime.now(timezone.utc))
    return ok({'verified': verified, 'status': 'verified' if verified else 'not_verified'})


@router.delete('')
def delete(db: Session = Depends(get_db), user: User = Depends(roles(UserRole.student))):
    user = lock_user(db, user.id)
    preview_ids = list(db.scalars(select(StudentCardPreview.id).where(StudentCardPreview.student_id == user.id)))
    from app.services.profile_avatar import clear_card_avatar
    clear_card_avatar(user)
    db.execute(update(StudentCardPreview).where(StudentCardPreview.student_id == user.id).values(status='INVALIDATED'))
    db.execute(update(StudentCardReference).where(StudentCardReference.student_id == user.id).values(status='INVALIDATED', sanitized_face=None))
    delete_face_embedding(db, user.id)
    user.student_card_status = 'NOT_SUBMITTED'
    identity = db.scalar(select(StudentIdentity).where(StudentIdentity.student_id == user.id).with_for_update())
    verifications = db.scalars(select(IdentityVerification).where(IdentityVerification.student_id == user.id)).all()
    paths = []
    for verification in verifications:
        paths.append(verification.image_path)
        db.delete(verification)
    if identity:
        paths.extend((identity.front_image_path, identity.left_image_path, identity.right_image_path))
        db.delete(identity)
    db.commit()
    for path in paths:
        _remove_image(path)
    for preview_id in preview_ids:
        _try_remove(preview_id)
    return ok({'deleted': True})
