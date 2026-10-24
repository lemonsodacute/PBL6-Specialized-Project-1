from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.api.responses import ok
from app.core.database import get_db
from app.models.entities import AttemptStatus, Exam, ExamAttempt, User, UserRole, ViolationLog
from app.schemas.proctoring import ViolationCreate
from app.services.attempts import finalize_expired_attempt
from app.services.monitoring import manager
from app.services.risk import update_risk_score
from app.services.audit import record_audit
from app.services.notifications import notify_teachers_of_exam
from app.proctoring.contracts import NormalizedProctorEvent
from app.services import proctor_events, proctor_realtime
import logging

router = APIRouter()
DEDUP_WINDOW = timedelta(seconds=3)
logger = logging.getLogger('app.audit')


def _error(code: str, message: str, status: int) -> HTTPException:
    return HTTPException(status, detail={'code': code, 'message': message, 'details': None})


def _attempt_for_user(attempt_id: UUID, db: Session, user: User) -> ExamAttempt:
    attempt = db.get(ExamAttempt, attempt_id)
    exam = db.get(Exam, attempt.exam_id) if attempt else None
    if not attempt or not exam:
        raise _error('NOT_FOUND', 'Attempt not found', 404)
    if user.role == UserRole.student and attempt.student_id != user.id:
        raise _error('FORBIDDEN', 'You cannot access this attempt', 403)
    if user.role == UserRole.teacher and exam.created_by != user.id:
        raise _error('FORBIDDEN', 'You cannot access this attempt', 403)
    return attempt


def _serialize(row: ViolationLog) -> dict:
    return {
        'id': row.id, 'attempt_id': row.attempt_id, 'type': row.type,
        'severity': row.severity, 'metadata_json': row.metadata_json,
        'occurred_at': row.occurred_at, 'created_at': row.created_at,
    }


@router.get('/violations/{attempt_id}')
def list_violations(attempt_id: UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    attempt = _attempt_for_user(attempt_id, db, user)
    if finalize_expired_attempt(db, attempt):
        db.commit()
    rows = db.scalars(select(ViolationLog).where(ViolationLog.attempt_id == attempt_id).order_by(ViolationLog.occurred_at)).all()
    return ok([_serialize(row) for row in rows])


def _record_violation(attempt_id: UUID, payload: ViolationCreate, db: Session, user: User):
    if user.role != UserRole.student:
        raise _error('FORBIDDEN', 'Only the attempt owner can submit violations', 403)
    attempt = _attempt_for_user(attempt_id, db, user)
    if finalize_expired_attempt(db, attempt):
        db.commit()
    if attempt.status != AttemptStatus.in_progress:
        return ok({'locked': attempt.status == AttemptStatus.terminated, 'deduplicated': False, 'attempt_status': attempt.status}),None,None
    now = datetime.now(timezone.utc)
    latest = db.scalar(select(ViolationLog).where(
        ViolationLog.attempt_id == attempt.id, ViolationLog.type == payload.type,
    ).order_by(ViolationLog.occurred_at.desc()).limit(1))
    if latest and now - (latest.occurred_at.replace(tzinfo=timezone.utc) if latest.occurred_at.tzinfo is None else latest.occurred_at) <= DEDUP_WINDOW:
        return ok({'locked': attempt.status == AttemptStatus.terminated, 'deduplicated': True, 'attempt_status': attempt.status, 'violation': _serialize(latest)}),None,None
    row = ViolationLog(
        attempt_id=attempt.id, type=payload.type, severity=payload.severity,
        metadata_json=payload.metadata_json, occurred_at=now, created_at=now,
    )
    db.add(row)
    db.flush()
    record_audit(db, action='violation_recorded', user_id=user.id, entity_type='attempt', entity_id=attempt.id, metadata={'type': payload.type.value, 'severity': payload.severity.value})
    # Retain the existing browser policy/log. Its human-review envelope is explicitly
    # self-reported and cannot masquerade as an authoritative AI/CRITICAL detection.
    proctor_change = None
    try:
      signal = proctor_events.ingest(db, NormalizedProctorEvent(external_id=row.id, provider='browser_signals',
        exam_id=attempt.exam_id, attempt_id=attempt.id, student_id=attempt.student_id,
        source='TAB_SWITCH' if payload.type.value=='tab_switch' else 'BROWSER',
        event_type='tab_switched' if payload.type.value=='tab_switch' else payload.type.value,
        severity='info' if payload.type.value in {'network_offline','network_online'} else 'low',
        confidence=None, occurred_at=now, metadata={'browser_type':payload.type.value,'browser_violation_id':row.id}), mode='browser', actor_id=user.id)
      proctor_change = proctor_realtime.change(db, signal.event, 'proctor_event_created' if signal.created else 'proctor_event_updated') if signal.event else None
    except HTTPException as error:
      # The review envelope cannot change existing browser recording/lock policy.
      if error.status_code not in (409,429): raise
    score = update_risk_score(db, attempt)
    predicted_count = attempt.violation_count + 1
    threshold = db.get(Exam, attempt.exam_id).violation_auto_lock_threshold
    locked = threshold is not None and predicted_count >= threshold
    if locked:
        attempt.status = AttemptStatus.terminated
        attempt.submitted_at = now
        record_audit(db, action='attempt_locked', user_id=user.id, entity_type='attempt', entity_id=attempt.id, metadata={'violation_count': predicted_count})
        logger.warning('attempt_locked_by_violations', extra={'attempt_id': str(attempt.id), 'exam_id': str(attempt.exam_id), 'violation_count': predicted_count})
    db.commit()
    db.refresh(row)
    db.refresh(attempt)
    if locked:
        notify_teachers_of_exam(
            db, attempt.exam_id, 'attempt_terminated', 'Bài thi bị khoá do vi phạm',
            f'Sinh viên {user.full_name} đã bị khoá bài thi sau {predicted_count} lần vi phạm.',
            related_attempt_id=attempt.id, severity='critical',
        )
        db.commit()
    data = {'violation': _serialize(row), 'locked': locked, 'attempt_status': attempt.status, 'violation_count': attempt.violation_count, 'risk_score': score}
    return ok(data),proctor_change,(attempt.exam_id,data,locked)


@router.post('/attempts/{attempt_id}/violations')
async def create_violation(attempt_id: UUID, payload: ViolationCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    response,change,broadcast=await run_in_threadpool(_record_violation,attempt_id,payload,db,user)
    await proctor_realtime.after_commit(db,change)
    if not broadcast: return response
    exam_id,data,locked=broadcast
    await manager.broadcast(exam_id, {'type': 'violation', 'data': data})
    if locked:
        await manager.broadcast(exam_id, {
            'type': 'attempt_update',
            'data': {'attempt_id': attempt_id, 'status': data['attempt_status'], 'violation_count': data['violation_count'], 'risk_score': data['risk_score']},
        })
    return response
