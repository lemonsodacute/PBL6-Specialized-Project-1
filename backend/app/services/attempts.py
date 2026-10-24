from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.entities import AttemptStatus, ExamAttempt
from app.services.grading import grade_attempt
from app.services.audit import record_audit
import logging

logger = logging.getLogger('app.audit')


def finalize_expired_attempt(db: Session, attempt: ExamAttempt, now: datetime | None = None) -> bool:
    # Finalization can be triggered by several endpoints at the same time
    # (polling, answer save, submit, proctoring). Lock the row before checking
    # the state so grading and the auto-submitted audit event happen once.
    db.refresh(attempt, with_for_update=True)
    if attempt.status != AttemptStatus.in_progress or not attempt.server_deadline_at:
        return False
    now = now or datetime.now(timezone.utc)
    deadline = attempt.server_deadline_at
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    if now <= deadline:
        return False
    grade_attempt(db, attempt)
    attempt.status = AttemptStatus.auto_submitted
    attempt.submitted_at = now
    db.flush()
    record_audit(db, action='attempt_auto_submitted', user_id=attempt.student_id, entity_type='attempt', entity_id=attempt.id, metadata={'exam_id': str(attempt.exam_id)})
    logger.info('attempt_auto_submitted', extra={'attempt_id': str(attempt.id), 'exam_id': str(attempt.exam_id)})
    return True
