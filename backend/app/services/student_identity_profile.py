"""Admin-only authoritative profile operations; callers own the transaction.

Card previews/references must bind to identity_profile_version and reject any
version other than the current one. No OCR or biometric inference runs here.
"""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.entities import StudentCardPreview, StudentCardReference, User, UserRole


def profile_error(code: str, message: str, status: int = 409) -> HTTPException:
    return HTTPException(status, detail={'code': code, 'message': message, 'details': None})


def lock_user(db: Session, user_id: UUID) -> User:
    user = db.scalar(select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True))
    if user is None:
        raise profile_error('NOT_FOUND', 'Không tìm thấy tài khoản.', 404)
    return user


def validate_student_code(db: Session, role: UserRole, code: str | None, user_id: UUID | None = None) -> None:
    if code is None:
        return
    if role != UserRole.student:
        raise profile_error('STUDENT_PROFILE_REQUIRED', 'Mã sinh viên chỉ dành cho tài khoản sinh viên.', 422)
    query = select(User.id).where(User.student_code == code)
    if user_id is not None:
        query = query.where(User.id != user_id)
    if db.scalar(query) is not None:
        raise profile_error('STUDENT_CODE_EXISTS', 'Mã sinh viên đã được sử dụng.')


def update_profile(db: Session, user: User, values: dict) -> None:
    new_role = values.get('role', user.role)
    if new_role != UserRole.student and user.role == UserRole.student:
        values = {**values, 'student_code': None}
    validate_student_code(db, new_role, values.get('student_code', user.student_code), user.id)
    identity_changed = any(key in values and values[key] != getattr(user, key)
                           for key in ('full_name', 'student_code', 'role', 'is_active'))
    if identity_changed:
        from app.services.profile_avatar import clear_card_avatar
        clear_card_avatar(user)
        db.execute(update(StudentCardPreview).where(StudentCardPreview.student_id == user.id, StudentCardPreview.status == 'PENDING').values(status='INVALIDATED'))
        db.execute(update(StudentCardReference).where(StudentCardReference.student_id == user.id, StudentCardReference.status == 'ACTIVE').values(status='INVALIDATED', sanitized_face=None))
        user.identity_profile_version += 1
        user.identity_profile_status = 'PENDING'
        user.identity_verified_at = None
        user.identity_verified_by = None
        if user.student_card_status != 'NOT_SUBMITTED':
            user.student_card_status = 'NEEDS_REUPLOAD'
    for key, value in values.items():
        setattr(user, key, value)
    user.updated_at = datetime.now(timezone.utc)


def verify_profile(user: User, admin: User, expected_version: int) -> bool:
    if user.role != UserRole.student or not user.is_active:
        raise profile_error('STUDENT_PROFILE_REQUIRED', 'Cần tài khoản sinh viên đang hoạt động.')
    if user.identity_profile_version != expected_version:
        raise profile_error('PROFILE_CHANGED', 'Hồ sơ đã thay đổi. Vui lòng tải lại trước khi xác nhận.')
    if not user.full_name.strip():
        raise profile_error('PROFILE_INCOMPLETE', 'Cần họ tên trước khi xác nhận hồ sơ. MSSV còn thiếu được bổ sung khi xác nhận thẻ sinh viên.')
    if user.identity_profile_status == 'VERIFIED':
        return False
    user.identity_profile_status = 'VERIFIED'
    user.identity_verified_at = user.updated_at = datetime.now(timezone.utc)
    user.identity_verified_by = admin.id
    return True
