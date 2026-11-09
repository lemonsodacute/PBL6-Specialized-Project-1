"""Validated triage events. Never calls grading, identity, auto-lock or risk scoring."""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models.entities import (AttemptStatus, AuditLog, DetectionEvent, Exam, ExamAttempt, ExamStatus,
    Notification, NotificationType, ProctorEventReceipt, ProctoringSession, ProctorModelHealth, SeverityLevel, User, UserRole)
from app.proctoring.contracts import EVENT_LABELS, EventPolicy, ModelConfig, NormalizedProctorEvent, ReviewEvent
from app.services.audit import record_audit


def fail(status, code, message):
    raise HTTPException(status, detail={'code': code, 'message': message, 'details': None})


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def simulator_enabled():
    return settings.ENVIRONMENT.lower() in {'development', 'test'} and settings.PROCTOR_SIMULATOR_ENABLED


def exam_access(db: Session, exam_id: UUID, user: User):
    if user.role not in (UserRole.teacher, UserRole.admin):
        fail(403, 'FORBIDDEN', 'Monitoring is restricted to teachers and administrators.')
    exam = db.get(Exam, exam_id)
    if not exam or exam.deleted_at:
        fail(404, 'NOT_FOUND', 'Exam not found.')
    if user.role != UserRole.admin and exam.created_by != user.id:
        fail(403, 'FORBIDDEN', 'You do not manage this exam.')
    return exam


def recipients(db, exam):
    return db.scalars(select(User.id).where(User.is_active.is_(True),
        (User.role == UserRole.admin) | ((User.role == UserRole.teacher) & (User.id == exam.created_by)))).all()


def model_config(provider):
    import re
    if provider in {'legacy','browser_signals','test_simulator'} or not re.fullmatch(r'[a-z][a-z0-9_-]{0,63}',provider):
        fail(422,'INVALID_PROVIDER','Reserved or invalid model provider.')
    raw = settings.PROCTOR_MODELS.get(provider)
    if not settings.PROCTOR_MODEL_ENABLED or raw is None:
        fail(503, 'MODEL_DISABLED', 'The monitoring module is not enabled.')
    try:
        config = ModelConfig.model_validate(raw)
    except ValidationError:
        fail(503, 'MODEL_NOT_CONFIGURED', 'The monitoring module is not calibrated/configured.')
    if not config.enabled or config.source in {'LEGACY', 'BROWSER', 'TEST_SIMULATOR', 'TAB_SWITCH'}:
        fail(503, 'MODEL_DISABLED', 'The monitoring module is not enabled.')
    return config


def policy_for(event, mode):
    if mode == 'simulator':
        if not simulator_enabled() or event.provider != 'test_simulator' or event.source != 'TEST_SIMULATOR':
            fail(404, 'NOT_FOUND', 'Simulator is unavailable.')
        if event.event_type not in {'multiple_faces', 'gaze_away'}:
            fail(422, 'UNSUPPORTED_EVENT', 'Unsupported simulator event.')
        # Explicit transport-test policy, never used by a production adapter.
        return EventPolicy(minimum_duration_ms=0, maximum_gap_ms=1000, cooldown_ms=5000, severity=event.severity)
    if mode == 'browser':
        if event.provider != 'browser_signals' or event.source not in {'BROWSER', 'TAB_SWITCH'}:
            fail(422, 'INVALID_SOURCE', 'Invalid browser signal origin.')
        return EventPolicy(minimum_duration_ms=0, maximum_gap_ms=1000, cooldown_ms=3000, severity=event.severity)
    config = model_config(event.provider)
    policy = config.policies.get(event.event_type)
    if event.source != config.source or event.event_type not in config.label_map.values() or not policy or not policy.calibrated:
        fail(422, 'UNSUPPORTED_EVENT', 'This event is not supported by the configured module.')
    if event.severity != policy.severity_for(event.confidence):
        fail(422, 'INVALID_SEVERITY', 'Severity must match the server-owned model policy and confidence.')
    return policy


def active_attempt(db, event, now):
    attempt = db.scalar(select(ExamAttempt).where(ExamAttempt.id == event.attempt_id).with_for_update())
    exam = db.get(Exam, event.exam_id)
    student = db.get(User, event.student_id)
    if not attempt or not exam or exam.deleted_at or not student:
        fail(404, 'NOT_FOUND', 'Exam, attempt or student not found.')
    if attempt.exam_id != exam.id or attempt.student_id != student.id or student.role != UserRole.student:
        fail(422, 'INVALID_ATTEMPT_LINK', 'The event links do not match the attempt.')
    if not student.is_active or attempt.status != AttemptStatus.in_progress or exam.status not in (ExamStatus.published, ExamStatus.ongoing):
        fail(409, 'ATTEMPT_INACTIVE', 'The attempt is no longer active.')
    if now < utc(exam.start_time) or now > utc(exam.end_time) or not attempt.started_at or not attempt.server_deadline_at or now > utc(attempt.server_deadline_at):
        fail(409, 'ATTEMPT_INACTIVE', 'The attempt is outside its active exam window.')
    first, last = utc(event.first_seen or event.occurred_at), utc(event.last_seen or event.occurred_at)
    if utc(event.occurred_at) < now - timedelta(minutes=5) or last > now + timedelta(seconds=30) or first < utc(attempt.started_at) or last > utc(attempt.server_deadline_at) + timedelta(seconds=30):
        fail(422, 'INVALID_EVENT_TIME', 'The event time is outside the permitted attempt window.')
    return attempt, exam, student


@dataclass
class IngestResult:
    event: DetectionEvent | None
    created: bool = False
    duplicate: bool = False
    suppressed: str | None = None


def ingest(db: Session, event: NormalizedProctorEvent, *, mode='model', actor_id=None) -> IngestResult:
    policy = policy_for(event, mode)
    now = datetime.now(timezone.utc)
    attempt, exam, student = active_attempt(db, event, now)
    receipt = db.get(ProctorEventReceipt, (attempt.id, event.provider, event.external_id))
    if receipt:
        row = db.get(DetectionEvent, receipt.event_id)
        if row.event_type != event.event_type or row.source != event.source:
            fail(409, 'IDEMPOTENCY_CONFLICT', 'The retry key was already used for another event.')
        return IngestResult(row, duplicate=True)
    if policy.confidence_threshold is not None and (event.confidence is None or event.confidence < policy.confidence_threshold):
        return IngestResult(None, suppressed='confidence_threshold')
    first, last = utc(event.first_seen or event.occurred_at), utc(event.last_seen or event.occurred_at)
    if (last - first).total_seconds() * 1000 < policy.minimum_duration_ms:
        return IngestResult(None, suppressed='temporal_threshold')
    rate = db.scalar(select(func.count()).select_from(ProctorEventReceipt).where(
        ProctorEventReceipt.attempt_id == attempt.id, ProctorEventReceipt.created_at > now - timedelta(minutes=1))) or 0
    if rate >= settings.PROCTOR_INGEST_PER_MINUTE:
        fail(429, 'PROCTOR_RATE_LIMIT', 'Monitoring event intake is temporarily limited.')
    session = db.scalar(select(ProctoringSession).where(ProctoringSession.attempt_id == attempt.id))
    if not session:
        session = ProctoringSession(id=uuid4(), attempt_id=attempt.id, started_at=now)
        db.add(session); db.flush()
    simulated = mode == 'simulator'
    # The locked attempt serializes concurrent producers/retries across workers.
    row = db.scalar(select(DetectionEvent).where(DetectionEvent.attempt_id == attempt.id,
        DetectionEvent.provider == event.provider, DetectionEvent.source == event.source,
        DetectionEvent.event_type == event.event_type, DetectionEvent.is_simulated == simulated,
        # A new incident must never inherit a teacher's previous dismissal/confirmation.
        DetectionEvent.status == 'NEW',
        DetectionEvent.last_seen >= first - timedelta(milliseconds=policy.cooldown_ms))
        .order_by(DetectionEvent.last_seen.desc()).with_for_update().limit(1))
    created = row is None
    if created:
        row = DetectionEvent(id=uuid4(), proctoring_session_id=session.id, attempt_id=attempt.id, exam_id=exam.id,
            student_id=student.id, provider=event.provider, source=event.source, event_type=event.event_type,
            confidence_score=event.confidence, max_confidence=event.confidence, severity=event.severity,
            message=event.message or EVENT_LABELS.get(event.event_type, event.event_type),
            metadata_json=event.metadata.model_dump(mode='json', exclude_none=True),
            evidence_json=event.evidence.model_dump(mode='json', exclude_none=True) if event.evidence else None,
            occurred_at=event.occurred_at, received_at=now, first_seen=first, last_seen=last,
            duration_ms=int((last-first).total_seconds()*1000), occurrence_count=1, is_simulated=simulated,
            status='NEW', review_version=0)
        db.add(row); db.flush()
        audit=record_audit(db, action='proctor_event_generated', user_id=actor_id, entity_type='proctor_event', entity_id=row.id,
            metadata={'exam_id':str(exam.id), 'attempt_id':str(attempt.id), 'source':row.source, 'event_type':row.event_type, 'is_simulated':simulated})
        audit.created_at=now
        if row.severity in (SeverityLevel.medium, SeverityLevel.high, SeverityLevel.critical):
            for recipient in recipients(db, exam):
                db.add(Notification(id=uuid4(), recipient_user_id=recipient, type=NotificationType.violation_alert,
                    title=('[Mô phỏng] ' if simulated else '') + 'Cảnh báo giám sát mới',
                    message=f'{student.full_name} · {row.message}', related_exam_id=exam.id, related_attempt_id=attempt.id,
                    related_proctor_event_id=row.id, proctor_event_simulated=simulated, severity=row.severity.value, is_read=False, created_at=now))
    else:
        row.first_seen, row.last_seen = min(utc(row.first_seen), first), max(utc(row.last_seen), last)
        incoming_incident = str(event.metadata.incident_id) if mode == 'model' and event.metadata.incident_id else None
        prior_incident = (row.metadata_json or {}).get('incident_id')
        # Confidence upgrades keep the same incident ID; a genuine reappearance
        # has a new ID. Do not count camera frames or priority upgrades as reoffenses.
        new_incident = not incoming_incident or incoming_incident != prior_incident
        observed_ms = int((last-first).total_seconds()*1000)
        if new_incident:
            row.occurrence_count += 1
            row.duration_ms += observed_ms
        else:
            row.duration_ms = max(row.duration_ms, observed_ms)
        if incoming_incident:
            row.metadata_json = {**(row.metadata_json or {}), 'incident_id':incoming_incident}
        if event.confidence is not None:
            row.confidence_score = Decimal(str(event.confidence))
            row.max_confidence = max(row.max_confidence if row.max_confidence is not None else Decimal('0'), Decimal(str(event.confidence)))
        # A later high-confidence observation can raise the severity of an existing
        # aggregated event. Never downgrade it, reset a human decision or duplicate a toast.
        severity_rank = {level: rank for rank, level in enumerate(SeverityLevel)}
        if severity_rank[event.severity] > severity_rank[row.severity]:
            row.severity = event.severity
            if row.status == 'NEW':
                db.execute(update(Notification).where(Notification.related_proctor_event_id == row.id)
                    .values(severity=row.severity.value, is_read=False))
    db.add(ProctorEventReceipt(attempt_id=attempt.id, provider=event.provider, external_id=event.external_id, event_id=row.id, created_at=now))
    if mode == 'model':
        touch_health(db, event.provider, 'ACTIVE')
    db.flush()
    return IngestResult(row, created=created)


def touch_health(db, provider, status, error_code=None):
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from sqlalchemy.dialects.sqlite import insert as sqlite_insert
    insert = pg_insert if db.bind.dialect.name=='postgresql' else sqlite_insert
    previous=db.get(ProctorModelHealth,provider)
    changed=previous is None or previous.status!=status or previous.error_code!=error_code
    values={'provider':provider,'status':status,'error_code':error_code,'updated_at':datetime.now(timezone.utc)}
    db.execute(insert(ProctorModelHealth).values(**values).on_conflict_do_update(index_elements=['provider'],set_=values))
    if previous is not None: db.expire(previous)
    return changed


def serialize(db, row, *, attempt=None, student=None):
    attempt = attempt if attempt is not None else db.get(ExamAttempt, row.attempt_id)
    student = student if student is not None else db.get(User, row.student_id or attempt.student_id)
    return {'id':row.id, 'exam_id':row.exam_id or attempt.exam_id, 'attempt_id':row.attempt_id,
        'student_id':student.id, 'student':{'id':student.id,'full_name':student.full_name,'student_code':student.student_code},
        'source':row.source, 'provider':row.provider, 'event_type':row.event_type, 'severity':row.severity,
        'confidence':row.confidence_score, 'max_confidence':row.max_confidence,
        'occurred_at':row.occurred_at, 'received_at':row.received_at, 'first_seen':row.first_seen or row.occurred_at,
        'last_seen':row.last_seen or row.occurred_at, 'duration_ms':row.duration_ms, 'occurrence_count':row.occurrence_count,
        'message':row.message or EVENT_LABELS.get(row.event_type, row.event_type), 'metadata':row.metadata_json,
        'evidence':row.evidence_json, 'has_snapshot':bool(row.source=='LEGACY' and row.snapshot_url), 'status':row.status, 'is_simulated':row.is_simulated,
        'reviewed_at':row.reviewed_at, 'reviewed_by':row.reviewed_by, 'review_note':row.review_note, 'review_version':row.review_version}


def event_access(db, event_id, user, *, lock=False):
    query = select(DetectionEvent).where(DetectionEvent.id == event_id)
    row = db.scalar(query.with_for_update() if lock else query)
    if row is None: fail(404, 'NOT_FOUND', 'Event not found.')
    attempt = db.get(ExamAttempt, row.attempt_id)
    exam_access(db, attempt.exam_id, user)
    return row


def review(db, event_id, user, payload: ReviewEvent):
    row = event_access(db, event_id, user, lock=True)
    if row.review_version != payload.expected_version:
        fail(409, 'REVIEW_CONFLICT', 'Another reviewer updated this alert. Reload before reviewing again.')
    status = payload.status.value
    if status == row.status:
        return row, False
    if status == 'REVIEWED' and row.status != 'NEW':
        fail(409, 'INVALID_REVIEW_TRANSITION', 'This event already has a review decision.')
    previous = row.status
    row.status, row.reviewed_by, row.reviewed_at = status, user.id, datetime.now(timezone.utc)
    row.review_note, row.review_version = (payload.note.strip() or None) if payload.note else None, row.review_version + 1
    db.execute(update(Notification).where(Notification.related_proctor_event_id==row.id,
        Notification.recipient_user_id==user.id).values(is_read=True))
    audit=record_audit(db, action='proctor_event_' + status.lower(), user_id=user.id, entity_type='proctor_event', entity_id=row.id,
        metadata={'from':previous,'to':status,'note':row.review_note,'is_simulated':row.is_simulated})
    audit.created_at=row.reviewed_at
    db.flush()
    return row, True


def review_history(db, row):
    records = db.execute(select(AuditLog, User.full_name).outerjoin(User, AuditLog.user_id == User.id)
        .where(AuditLog.entity_type == 'proctor_event', AuditLog.entity_id == row.id)
        .order_by(AuditLog.created_at, AuditLog.id)).all()
    return [{'id':item.id,'action':item.action,'at':item.created_at,'actor':name,'actor_id':item.user_id,
        'status':(item.metadata_json or {}).get('to'),'note':(item.metadata_json or {}).get('note')} for item,name in records]
