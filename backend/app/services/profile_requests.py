"""Persistent review intent, separate from authoritative identity status.

Callers own commit/rollback. All transitions lock the parent student first.
Notifications are transactional in-app records, without outbound email.
"""
from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import select
from app.models.entities import ProfileVerificationRequest, User, UserRole
from app.services.notifications import create_notification
from app.services.student_identity_profile import lock_user, profile_error


def pending(db, student_id):
    return db.scalar(select(ProfileVerificationRequest).where(
        ProfileVerificationRequest.student_id == student_id, ProfileVerificationRequest.status == 'PENDING'
    ).execution_options(populate_existing=True))


def student_status(db, user):
    row = db.scalar(select(ProfileVerificationRequest).where(ProfileVerificationRequest.student_id == user.id)
        .order_by(ProfileVerificationRequest.requested_at.desc(), ProfileVerificationRequest.id.desc()).limit(1))
    # COMPLETED history never re-verifies a profile reset by authoritative edits.
    status = row.status if row and row.status in ('PENDING', 'REJECTED') and user.identity_profile_status == 'PENDING' else 'NOT_REQUESTED'
    return {'identity_profile_status': user.identity_profile_status,
        'verification_request_status': status,
        'verification_requested_at': row.requested_at.isoformat() if status != 'NOT_REQUESTED' else None,
        'verification_rejection_reason': row.rejection_reason if status == 'REJECTED' else None}


def request_verification(db, student_id):
    user = lock_user(db, student_id)
    if user.role != UserRole.student or not user.is_active:
        raise profile_error('FORBIDDEN', 'Cần tài khoản sinh viên đang hoạt động.', 403)
    if user.identity_profile_status != 'PENDING':
        raise profile_error('PROFILE_ALREADY_VERIFIED', 'Hồ sơ sinh viên của bạn đã được xác nhận.')
    if pending(db, user.id) is not None:
        return user  # Idempotent: no duplicate row, timestamp or notifications.
    row = ProfileVerificationRequest(id=uuid4(), student_id=user.id, status='PENDING', requested_at=datetime.now(timezone.utc))
    db.add(row)
    db.flush()
    admins = list(db.scalars(select(User.id).where(User.role == UserRole.admin, User.is_active.is_(True)).order_by(User.id)))
    for admin_id in admins:
        create_notification(db, admin_id, 'profile_verification_request', 'Yêu cầu xác minh hồ sơ',
            f'{user.full_name} đã gửi yêu cầu xác minh hồ sơ.', related_student_id=user.id, send_email=False)
    return user


def complete_request(db, user, admin):
    """Called only after the existing verify_profile accepts current version."""
    row = pending(db, user.id)
    if row:
        row.status = 'COMPLETED'
        row.reviewed_at = datetime.now(timezone.utc)
        row.reviewed_by = admin.id
    create_notification(db, user.id, 'profile_verification_result', 'Hồ sơ đã được xác nhận',
        'Hồ sơ sinh viên của bạn đã được xác nhận.', related_student_id=user.id, send_email=False)


def cancel_ineligible_request(db, user):
    if user.role == UserRole.student and user.is_active:
        return  # Admin corrections keep the student's review intent pending.
    row = pending(db, user.id)
    if row:
        row.status = 'CANCELLED'
        row.reviewed_at = datetime.now(timezone.utc)


def reject_request(db, request_id, admin, version, reason):
    owner = db.scalar(select(ProfileVerificationRequest.student_id).where(ProfileVerificationRequest.id == request_id))
    if owner is None:
        raise profile_error('REQUEST_NOT_FOUND', 'Không tìm thấy yêu cầu.', 404)
    user = lock_user(db, owner)
    row = db.scalar(select(ProfileVerificationRequest).where(ProfileVerificationRequest.id == request_id).execution_options(populate_existing=True))
    if row is None or row.status != 'PENDING':
        raise profile_error('REQUEST_ALREADY_REVIEWED', 'Yêu cầu đã được xử lý. Vui lòng tải lại danh sách.')
    if user.identity_profile_version != version:
        raise profile_error('PROFILE_CHANGED', 'Hồ sơ đã thay đổi. Vui lòng xem lại trước khi xử lý.')
    if user.identity_profile_status != 'PENDING' or user.role != UserRole.student or not user.is_active:
        raise profile_error('REQUEST_NOT_REVIEWABLE', 'Hồ sơ hiện không còn phù hợp để xử lý yêu cầu này.')
    row.status, row.rejection_reason = 'REJECTED', reason
    row.reviewed_at, row.reviewed_by = datetime.now(timezone.utc), admin.id
    create_notification(db, user.id, 'profile_verification_result', 'Kết quả yêu cầu xác minh hồ sơ',
        'Yêu cầu xác minh hồ sơ chưa được chấp nhận. Vui lòng xem lý do trong Hồ sơ.', related_student_id=user.id, send_email=False)
    return row
