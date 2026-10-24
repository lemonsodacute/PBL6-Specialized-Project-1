"""Private preview persistence and retention, independent of OCR/face inference.

create_preview is an internal transaction boundary. Its caller must finish
validation/inference first and supply sanitized JPEG previews. Public requests
cannot supply these server-owned fields.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import logging
from pathlib import Path
import re
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.entities import StudentCardPreview, User, UserRole
from app.services.face_recognition import MAX_IMAGE_BYTES

PREVIEW_ROOT = Path(__file__).resolve().parents[2] / 'private' / 'identity' / 'previews'
PREVIEW_TTL = timedelta(minutes=10)
PRIVATE_HEADERS = {'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff'}
logger = logging.getLogger(__name__)


def preview_error(code, message, status=409):
    return HTTPException(status, detail={'code': code, 'message': message, 'details': None}, headers=PRIVATE_HEADERS)


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def require_profile(user):
    if user.role != UserRole.student or not user.is_active:
        raise preview_error('FORBIDDEN', 'Cần tài khoản sinh viên đang hoạt động.', 403)
    if user.identity_profile_status != 'VERIFIED' or not user.full_name.strip():
        raise preview_error('PROFILE_NOT_VERIFIED', 'Hồ sơ sinh viên của bạn chưa được xác nhận.', 403)


def private_path(key):
    if not isinstance(key, str) or not re.fullmatch(r'[0-9a-f]{32}/(original\.bin|card\.jpg|face\.jpg)', key):
        raise preview_error('PREVIEW_NOT_FOUND', 'Không tìm thấy ảnh xem trước.', 404)
    root = PREVIEW_ROOT.resolve()
    path = (root / key).resolve()
    if not path.is_relative_to(root):
        raise preview_error('PREVIEW_NOT_FOUND', 'Không tìm thấy ảnh xem trước.', 404)
    return path


def remove_files(preview_id):
    """Delete only our three fixed filenames, never recursively follow paths."""
    directory = None
    for name in ('original.bin', 'card.jpg', 'face.jpg'):
        path = private_path(f'{preview_id.hex}/{name}')
        directory = path.parent
        path.unlink(missing_ok=True)
    if directory and directory.exists():
        directory.rmdir()


def _try_remove(preview_id):
    try:
        remove_files(preview_id)
        return True
    except (OSError, HTTPException):
        logger.warning('Student-card preview cleanup will be retried')
        return False


def create_preview(db: Session, student_id: UUID, profile_version: int, *, original: bytes, card: bytes, face: bytes,
                   extracted: dict, validation: dict, ocr_model_version: str, parser_version: str,
                   matching_version: str, confidence: dict | None = None, expected_admin_version: int | None = None) -> StudentCardPreview:
    if any(not value or len(value) > MAX_IMAGE_BYTES for value in (original, card, face)):
        raise preview_error('INVALID_IMAGE', 'Ảnh xem trước không hợp lệ.', 422)
    preview_id = uuid4()
    try:
        user = db.scalar(select(User).where(User.id == student_id).with_for_update().execution_options(populate_existing=True))
        if user is None:
            raise preview_error('FORBIDDEN', 'Không tìm thấy tài khoản.', 403)
        require_profile(user)
        if user.identity_profile_version != profile_version or (expected_admin_version is not None and user.card_admin_version != expected_admin_version):
            raise preview_error('PROFILE_CHANGED', 'Hồ sơ đã thay đổi. Vui lòng tải lại ảnh thẻ.')
        previous = list(db.scalars(select(StudentCardPreview).where(StudentCardPreview.student_id == user.id, StudentCardPreview.status == 'PENDING')))
        for old in previous:
            old.status = 'SUPERSEDED'
        db.flush()  # Release the partial unique index before adding the new row.
        private_path(f'{preview_id.hex}/original.bin').parent.mkdir(parents=True, exist_ok=False)
        for name, data in (('original.bin', original), ('card.jpg', card), ('face.jpg', face)):
            with private_path(f'{preview_id.hex}/{name}').open('xb') as stream:
                stream.write(data)
        now = datetime.now(timezone.utc)
        row = StudentCardPreview(id=preview_id, student_id=user.id, status='PENDING', created_at=now, expires_at=now + PREVIEW_TTL,
                                 card_admin_version=user.card_admin_version,
                                 identity_profile_version=profile_version, original_image_key=f'{preview_id.hex}/original.bin',
                                 card_preview_key=f'{preview_id.hex}/card.jpg', face_preview_key=f'{preview_id.hex}/face.jpg',
                                 image_sha256=hashlib.sha256(original).hexdigest(), extracted_json=extracted, confidence_json=confidence,
                                 validation_json=validation, ocr_model_version=ocr_model_version, parser_version=parser_version,
                                 matching_version=matching_version)
        db.add(row)
        # A replacement preview never deactivates an already verified reference.
        db.commit()
    except (SQLAlchemyError, OSError):
        db.rollback()
        _try_remove(preview_id)
        # Driver parameters may contain OCR fields; never propagate them to logs.
        raise preview_error('PREVIEW_SAVE_FAILED', 'Chưa lưu được bản xem trước. Vui lòng thử lại.', 503) from None
    except BaseException:
        db.rollback()
        _try_remove(preview_id)
        raise
    for old in previous:
        _try_remove(old.id)
    return row


def load_preview(db: Session, preview_id: UUID, user: User, now=None) -> StudentCardPreview:
    user = db.scalar(select(User).where(User.id == user.id).execution_options(populate_existing=True))
    if user is None:
        raise preview_error('FORBIDDEN', 'Không tìm thấy tài khoản.', 403)
    require_profile(user)
    row = db.scalar(select(StudentCardPreview).where(StudentCardPreview.id == preview_id, StudentCardPreview.student_id == user.id).execution_options(populate_existing=True))
    if row is None:
        raise preview_error('PREVIEW_NOT_FOUND', 'Không tìm thấy bản xem trước.', 404)
    if row.identity_profile_version != user.identity_profile_version or row.card_admin_version != user.card_admin_version or row.status == 'INVALIDATED':
        raise preview_error('PROFILE_CHANGED', 'Hồ sơ đã thay đổi. Vui lòng tải lại ảnh thẻ.')
    if row.expires_at and utc(row.expires_at) <= (now or datetime.now(timezone.utc)):
        raise preview_error('PREVIEW_EXPIRED', 'Bản xem trước đã hết hạn. Vui lòng tải lại ảnh thẻ.', 410)
    if row.status == 'SUPERSEDED':
        raise preview_error('PREVIEW_SUPERSEDED', 'Bản xem trước đã được thay thế.')
    if row.status != 'PENDING':
        raise preview_error('PREVIEW_NOT_FOUND', 'Bản xem trước không còn khả dụng.', 404)
    return row


def read_image(row: StudentCardPreview, kind: str) -> bytes:
    key = row.card_preview_key if kind == 'card' else row.face_preview_key
    # Stored keys must belong to this preview, even if the DB record is damaged.
    if key != f'{row.id.hex}/{kind}.jpg':
        raise preview_error('PREVIEW_NOT_FOUND', 'Không tìm thấy ảnh xem trước.', 404)
    try:
        return private_path(key).read_bytes()
    except OSError:
        raise preview_error('PREVIEW_NOT_FOUND', 'Không tìm thấy ảnh xem trước.', 404) from None


def cleanup_previews(db: Session, now=None) -> int:
    """Expire/purge metadata, then remove files AFTER commit; retry via sweep.

    User locks use the same order as create/profile changes. No inference occurs
    in a transaction. Crash-orphan directories are swept after the same TTL.
    """
    now = now or datetime.now(timezone.utc)
    expired = or_(StudentCardPreview.expires_at <= now, StudentCardPreview.status != 'PENDING')
    owners = list(db.scalars(select(StudentCardPreview.student_id).where(expired).distinct().limit(100)))
    removed = 0
    for owner in owners:
        user = db.scalar(select(User).where(User.id == owner).with_for_update().execution_options(populate_existing=True))
        rows = list(db.scalars(select(StudentCardPreview).where(StudentCardPreview.student_id == owner, expired)))
        ids = [row.id for row in rows]
        for row in rows:
            db.delete(row)
        db.flush()
        db.commit()
        for preview_id in ids:
            if _try_remove(preview_id):
                removed += 1
    if PREVIEW_ROOT.exists():
        for directory in PREVIEW_ROOT.iterdir():
            if not re.fullmatch(r'[0-9a-f]{32}', directory.name) or directory.is_symlink() or not directory.is_dir():
                continue
            if datetime.fromtimestamp(directory.stat().st_mtime, timezone.utc) > now - PREVIEW_TTL:
                continue
            preview_id = UUID(hex=directory.name)
            if db.scalar(select(StudentCardPreview.id).where(StudentCardPreview.id == preview_id)) is None:
                if _try_remove(preview_id):
                    removed += 1
    return removed
