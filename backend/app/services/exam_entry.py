"""Short-lived, single-use exam entry proof using existing verification rows."""
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select
from fastapi import HTTPException

from app.models.entities import IdentityVerification
from app.services.student_card_identity import require_reference
from app.services.student_identity_profile import lock_user

ENTRY_TTL = timedelta(seconds=20)
ENTRY_PURPOSE = 'exam_entry'
ENTRY_MISMATCH = 'Không thể xác minh người đang ngồi trước camera là sinh viên đã xác thực.'
ENTRY_FACE_ERRORS = {
    'FACE_MISMATCH': ENTRY_MISMATCH,
    'NO_FACE_DETECTED': 'Không phát hiện khuôn mặt. Vui lòng nhìn thẳng vào camera.',
    'MULTIPLE_FACES_DETECTED': 'Phát hiện nhiều khuôn mặt. Chỉ một người được phép xuất hiện trước camera.',
}


def _utc(value):
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def entry_verification_is_current(verification, reference, user, exam_id, now):
    if verification is None or reference is None or verification.status != 'verified':
        return False
    metadata = verification.liveness_json
    if not isinstance(metadata, dict) or metadata.get('purpose') != ENTRY_PURPOSE or metadata.get('consumed_at'):
        return False
    if (verification.student_id != user.id or verification.exam_id != exam_id
            or reference.student_id != user.id or reference.status != 'ACTIVE'
            or verification.reference_version != reference.id
            or metadata.get('profile_version') != user.identity_profile_version):
        return False
    try:
        received = _utc(datetime.fromisoformat(metadata['frame_received_at']))
        created = _utc(verification.created_at)
        return _utc(reference.created_at) <= received <= created <= now and now - received <= ENTRY_TTL
    except (KeyError, TypeError, ValueError, AttributeError):
        return False


def consume_entry_verification(db, user, exam_id: UUID, verification_id: UUID | None):
    # Caller already holds the exam lock. Reference changes use this student lock.
    user = lock_user(db, user.id)
    reference = require_reference(db, user)
    verification = db.scalar(select(IdentityVerification).where(
        IdentityVerification.id == verification_id,
        IdentityVerification.student_id == user.id,
        IdentityVerification.exam_id == exam_id,
    ).with_for_update().execution_options(populate_existing=True)) if verification_id else None
    now = datetime.now(timezone.utc)  # Validate after waiting for every lock.
    if not entry_verification_is_current(verification, reference, user, exam_id, now):
        raise HTTPException(403, detail={'code': 'FINAL_IDENTITY_VERIFICATION_REQUIRED',
            'message': 'Vui lòng xác minh lại khuôn mặt ngay trước khi vào bài thi.', 'details': None})
    verification.liveness_json = {**verification.liveness_json, 'consumed_at': now.isoformat()}
    return now
