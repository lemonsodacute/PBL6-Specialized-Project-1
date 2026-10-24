"""Avatar presentation reuses the exact sanitized face, never biometric vectors.

The persisted pointer is optional presentation metadata. Read paths derive it
from the trusted ACTIVE reference so a failed post-confirm pointer update can
never break identity confirmation or keep a revoked image visible.
"""
import logging
from app.models.entities import UserRole
from app.services.student_identity_profile import lock_user

logger = logging.getLogger(__name__)


def clear_card_avatar(user):
    if getattr(user, 'avatar_source', None) == 'STUDENT_CARD' or getattr(user, 'avatar_reference_id', None) is not None:
        user.avatar_url = None
        user.avatar_source = None
        user.avatar_reference_id = None
        user.avatar_updated_at = None


def avatar_fields(db, user, reference=None):
    empty = {'avatar_url': None, 'avatar_source': None, 'avatar_reference_id': None, 'avatar_updated_at': None}
    if user.role != UserRole.student:
        if user.role == UserRole.teacher and user.avatar_source == 'TEACHER_UPLOAD':
            return {**empty, 'avatar_url': user.avatar_url, 'avatar_source': 'TEACHER_UPLOAD', 'avatar_updated_at': user.avatar_updated_at}
        return {**empty, 'avatar_url': user.avatar_url if user.avatar_source != 'STUDENT_CARD' else None}
    if reference is None:
        from app.services.student_card_identity import active_reference
        reference = active_reference(db, user)
    if not reference or not reference.sanitized_face:
        return empty
    return {'avatar_url': f'/api/v1/users/{user.id}/avatar/{reference.id}', 'avatar_source': 'STUDENT_CARD',
        'avatar_reference_id': reference.id, 'avatar_updated_at': reference.created_at}


def sync_card_avatar(db, student_id, confirmed_reference_id):
    """Best effort, AFTER the identity commit. Never overwrite a newer version."""
    try:
        user = lock_user(db, student_id)
        fields = avatar_fields(db, user)
        if fields['avatar_reference_id'] != confirmed_reference_id:
            db.rollback()
            return
        for name, value in fields.items():
            setattr(user, name, value)
        db.commit()
    except Exception:
        db.rollback()
        # Do not print SQL parameters, image bytes, OCR, IDs or storage locations.
        logger.warning('Profile avatar metadata unavailable; trusted reference remains usable')


def public_profile(db, user, schema):
    return schema.model_validate(user).model_copy(update=avatar_fields(db, user)).model_dump(mode='json')
