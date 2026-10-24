"""Admin operations share the student lock and existing reference trust rules.

No OCR results, images or biometric vectors are copied into audits/notifications.
The caller commits mutations, notifications and audits in one transaction.
"""
from datetime import datetime, timezone
from sqlalchemy import select, update
from app.models.entities import AuditLog, StudentCardPreview, StudentCardReference, User, UserRole
from app.services.audit import record_audit
from app.services.notifications import create_notification
from app.services.student_identity_profile import lock_user, profile_error
from app.services.profile_avatar import avatar_fields, clear_card_avatar


def latest_reference(db, student_id):
    return db.scalar(select(StudentCardReference).where(StudentCardReference.student_id == student_id)
        .order_by(StudentCardReference.created_at.desc(), StudentCardReference.id.desc()).limit(1)
        .execution_options(populate_existing=True))


def card_state(user):
    if user.student_card_status == 'NEEDS_REUPLOAD' and user.card_last_action == 'CARD_REVOKED':
        return 'REVOKED'
    return user.student_card_status


def audit_card(db, action, actor, student_id, reference_id=None, reason=None, **extra):
    return record_audit(db, action=action, user_id=actor.id, entity_type='student_card', entity_id=student_id,
        metadata={'actor_role': actor.role.value, 'actor_name': actor.full_name, 'student_id': str(student_id),
                  'reference_id': str(reference_id) if reference_id else None, 'reason': reason, **extra})


def notify_card(db, student, actor, title, message, reference_id=None, *, update_required=False, reason=None):
    row = create_notification(db, student.id, 'student_card_update' if update_required else 'student_card_notice',
        title, message, related_student_id=student.id, send_email=False)
    audit_card(db, 'CARD_NOTIFICATION_SENT', actor, student.id, reference_id, reason, notification_id=str(row.id))
    return row


def managed_student(db, student_id):
    user = lock_user(db, student_id)
    if user.role != UserRole.student:
        raise profile_error('NOT_FOUND', 'Không tìm thấy hồ sơ thẻ sinh viên.', 404)
    return user


def invalidate_card(db, student, actor, reason, *, revoke=False):
    clear_card_avatar(student)
    reference = latest_reference(db, student.id)
    # Same privacy policy as profile changes/replacements: retain reference metadata,
    # clear the sanitized image and stop trusting the versioned embedding.
    db.execute(update(StudentCardPreview).where(StudentCardPreview.student_id == student.id,
        StudentCardPreview.status == 'PENDING').values(status='INVALIDATED'))
    db.execute(update(StudentCardReference).where(StudentCardReference.student_id == student.id,
        StudentCardReference.status == 'ACTIVE').values(status='INVALIDATED', sanitized_face=None))
    if reference and revoke:
        reference.status = 'INVALIDATED'
        reference.sanitized_face = None
        reference.revoked_at = datetime.now(timezone.utc)
        reference.revoked_by = actor.id
        reference.revoke_reason = reason
    student.student_card_status = 'NEEDS_REUPLOAD'
    student.card_admin_version += 1
    student.card_update_reason = reason
    student.card_last_action = 'CARD_REVOKED' if revoke else 'CARD_UPDATE_REQUESTED'
    audit_card(db, student.card_last_action, actor, student.id, reference.id if reference else None, reason)
    title = 'Xác thực thẻ sinh viên đã bị thu hồi' if revoke else 'Yêu cầu cập nhật thẻ sinh viên'
    notify_card(db, student, actor, title,
        f'Quản trị viên yêu cầu bạn cập nhật lại thẻ sinh viên. Lý do: {reason}',
        reference.id if reference else None, update_required=True, reason=reason)


def check_snapshot(student, reference, payload):
    actual = reference.id if reference else None
    if (student.identity_profile_version != payload.identity_profile_version or
        student.card_admin_version != payload.card_admin_version or actual != payload.reference_id):
        raise profile_error('CARD_CHANGED', 'Hồ sơ hoặc thẻ đã thay đổi. Vui lòng tải lại và kiểm tra trước khi xử lý.', 409)


def serialize_reference(reference, actor=None, *, include_versions=False):
    if reference is None:
        return None
    result = {'id': str(reference.id), 'status': reference.status, 'verified_at': reference.created_at,
        'verified_by_user_id': str(reference.verified_by_user_id) if reference.verified_by_user_id else None,
        'verified_by_role': reference.verified_by_role, 'verified_by_name': actor.full_name if actor else None,
        'verification_source': reference.verification_source, 'identity_profile_version': reference.identity_profile_version,
        'revoked_at': reference.revoked_at, 'revoked_by': str(reference.revoked_by) if reference.revoked_by else None,
        'revoke_reason': reference.revoke_reason}
    if include_versions:
        result.update({key: getattr(reference, key) for key in ('ocr_model_version', 'parser_version', 'matching_version',
            'face_model_name', 'face_model_version', 'face_preprocessing_version')})
    return result


def serialize_student(user, reference, actor=None, *, detail=False, effective_status=None):
    return {'student_id': str(user.id), 'full_name': user.full_name, 'student_code': user.student_code,
        'class_name': user.class_name,
        'email': user.email, 'is_active': user.is_active, 'identity_profile_status': user.identity_profile_status,
        'identity_profile_version': user.identity_profile_version, 'student_card_status': user.student_card_status,
        'management_status': effective_status or card_state(user), 'card_admin_version': user.card_admin_version,
        'update_reason': user.card_update_reason, 'reference': serialize_reference(reference, actor, include_versions=detail)}


def history_query(student_id):
    return select(AuditLog).where(AuditLog.entity_type == 'student_card', AuditLog.entity_id == student_id,
        AuditLog.action.in_(['CARD_VERIFIED', 'CARD_REVOKED', 'CARD_UPDATE_REQUESTED', 'CARD_REPLACED', 'CARD_NOTIFICATION_SENT']))


def serialize_event(row):
    metadata = row.metadata_json or {}
    return {'id': str(row.id), 'action': row.action, 'actor_user_id': str(row.user_id) if row.user_id else None,
        'actor_role': metadata.get('actor_role'), 'actor_name': metadata.get('actor_name'),
        'student_id': str(row.entity_id), 'reference_id': metadata.get('reference_id'),
        'reason': metadata.get('reason'), 'created_at': row.created_at}
