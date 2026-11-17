import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, Header, Query, Request, WebSocket, UploadFile, File, HTTPException
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import case, func, select, union, or_
from sqlalchemy.orm import Session
from app.api.deps import current_user
from app.api.responses import ok
from app.core.config import settings
from app.core.database import get_db
from app.models.entities import (AttemptStatus, DetectionEvent, ExamAttempt, ExamAssignment, ClassEnrollment,
    ProctorModelHealth, ProctoringSession, Exam, ExamStatus, AuditLog, User, UserRole)
from app.proctoring.contracts import ModelConfig, NormalizedProctorEvent, ReviewEvent
from app.services import proctor_events as domain, proctor_realtime as realtime
from app.proctoring.adapters import configured_models, runtime, AdapterContext, MonitoringFrame
from app.proctoring.diagnostics import diagnostic

router = APIRouter()


def trusted_ingestor(x_proctor_service_key: str | None = Header(default=None)):
    if not settings.PROCTOR_INGEST_KEY or not x_proctor_service_key or not secrets.compare_digest(x_proctor_service_key, settings.PROCTOR_INGEST_KEY):
        domain.fail(401,'TRUSTED_CHANNEL_REQUIRED','A protected monitoring service credential is required.')


async def bounded_event(request):
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > 16384: domain.fail(413,'EVENT_TOO_LARGE','Monitoring event payload exceeds 16 KiB.')
    try:
        return NormalizedProctorEvent.model_validate_json(bytes(data))
    except ValidationError:
        domain.fail(422,'INVALID_PROCTOR_EVENT','Invalid normalized event. Check the event contract.')


async def persist(db, event, *, mode='model', actor_id=None):
    def save():
        try:
            result = domain.ingest(db,event,mode=mode,actor_id=actor_id)
            message = realtime.change(db,result.event,'proctor_event_created' if result.created else 'proctor_event_updated') if result.event and not result.duplicate else None
            db.commit()
            payload=ok({'stored':result.event is not None,'created':result.created,'duplicate':result.duplicate,'suppressed':result.suppressed,
                'event':domain.serialize(db,result.event) if result.event else None})
            return payload,message
        except Exception:
            db.rollback(); raise
    # SQLAlchemy is synchronous. A row-lock wait must never block response cleanup,
    # WebSocket delivery or another request's transaction on the asyncio loop.
    payload,message=await run_in_threadpool(save)
    await realtime.after_commit(db,message)
    return payload


@router.post('/events', dependencies=[Depends(trusted_ingestor)])
async def ingest_event(request: Request, db: Session = Depends(get_db)):
    return await persist(db,await bounded_event(request))


class SimulateEvent(BaseModel):
    model_config = ConfigDict(extra='forbid',allow_inf_nan=False)
    attempt_id: UUID
    event_type: Literal['multiple_faces','gaze_away']
    external_id: UUID = Field(default_factory=uuid4)


@router.post('/dev/simulate')
async def simulate(body: SimulateEvent, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if not domain.simulator_enabled(): domain.fail(404,'NOT_FOUND','Simulator is unavailable.')
    def prepare():
        attempt = db.get(ExamAttempt,body.attempt_id)
        if not attempt: domain.fail(404,'NOT_FOUND','Attempt not found.')
        domain.exam_access(db,attempt.exam_id,user)
        return NormalizedProctorEvent(external_id=body.external_id,provider='test_simulator',exam_id=attempt.exam_id,
            attempt_id=attempt.id,student_id=attempt.student_id,source='TEST_SIMULATOR',event_type=body.event_type,
            severity='high',confidence=None,occurred_at=datetime.now(timezone.utc),message='')
    event=await run_in_threadpool(prepare)
    return await persist(db,event,mode='simulator',actor_id=user.id)


def modules(db, *, admin=False):
    result = []
    for provider,raw in settings.PROCTOR_MODELS.items():
        try: config = ModelConfig.model_validate(raw)
        except ValidationError:
            result.append({'provider':provider,'label':str(provider)[:80],'source':'OTHER','status':'UNAVAILABLE'}); continue
        enabled = settings.PROCTOR_MODEL_ENABLED and config.enabled
        calibrated = config.policies and all(policy.calibrated for policy in config.policies.values())
        health = db.get(ProctorModelHealth,provider) if enabled else None
        state = 'DISABLED' if not enabled else 'UNAVAILABLE'
        if enabled and calibrated and health:
            state = health.status if domain.utc(health.updated_at) >= datetime.now(timezone.utc)-timedelta(seconds=settings.PROCTOR_MODEL_HEALTH_TIMEOUT_SECONDS) else 'UNAVAILABLE'
        item = {'provider':provider,'label':config.label,'source':config.source,'status':state}
        if admin: item.update(calibrated=bool(calibrated),last_seen=health.updated_at if health else None,error_code=health.error_code if health else None)
        result.append(item)
    return result


@router.get('/exams/{exam_id}/health')
def health(exam_id: UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    domain.exam_access(db,exam_id,user)
    return ok({'modules':modules(db,admin=user.role==UserRole.admin),'simulator_enabled':domain.simulator_enabled(),
        'message':'Chưa kết nối module AI giám sát.' if not settings.PROCTOR_MODEL_ENABLED or not settings.PROCTOR_MODELS else None})


def event_scope(exam_id, simulated):
    return [DetectionEvent.exam_id==exam_id,DetectionEvent.is_simulated==simulated]


def operational_summary(db, exam, simulated=False):
    scope = event_scope(exam.id,simulated)
    rows = db.execute(select(DetectionEvent.status,DetectionEvent.severity,func.count()).where(*scope)
        .group_by(DetectionEvent.status,DetectionEvent.severity)).all()
    counts = {'total':0,'new':0,'reviewed':0,'dismissed':0,'confirmed':0,'high_priority':0}
    for status,severity,count in rows:
        counts['total']+=count; counts[status.lower()]+=count
        if severity.value in ('high','critical'): counts['high_priority']+=count
    assigned = select(ExamAssignment.student_id.label('student_id')).where(ExamAssignment.exam_id==exam.id,ExamAssignment.student_id.is_not(None))
    enrolled = select(ClassEnrollment.student_id).join(ExamAssignment,ExamAssignment.class_id==ClassEnrollment.class_id).where(ExamAssignment.exam_id==exam.id)
    attempted = select(ExamAttempt.student_id).where(ExamAttempt.exam_id==exam.id)
    roster = union(assigned,enrolled,attempted).subquery()
    latest = select(ExamAttempt.student_id,func.max(ExamAttempt.attempt_number).label('number')).where(ExamAttempt.exam_id==exam.id).group_by(ExamAttempt.student_id).subquery()
    current = select(ExamAttempt).join(latest,(latest.c.student_id==ExamAttempt.student_id)&(latest.c.number==ExamAttempt.attempt_number)).where(ExamAttempt.exam_id==exam.id)
    active = db.scalar(select(func.count()).select_from(current.where(ExamAttempt.status==AttemptStatus.in_progress,ExamAttempt.server_deadline_at>=datetime.now(timezone.utc)).subquery())) or 0
    if exam.status not in (ExamStatus.published,ExamStatus.ongoing) or not (domain.utc(exam.start_time)<=datetime.now(timezone.utc)<=domain.utc(exam.end_time)):
        active=0
    submitted = db.scalar(select(func.count()).select_from(current.where(ExamAttempt.status.in_([AttemptStatus.submitted,AttemptStatus.auto_submitted,AttemptStatus.terminated])).subquery())) or 0
    return {**counts,'total_students':db.scalar(select(func.count()).select_from(roster)) or 0,'taking':active,'submitted':submitted}


@router.get('/exams/{exam_id}/events')
def list_events(exam_id: UUID, status: Literal['NEW','REVIEWED','DISMISSED','CONFIRMED'] | None = None,
    priority: bool = False, event_type: str | None = None, attempt_id: UUID | None = None, q: str = Query('',max_length=120),
    simulated: bool = False, page: int = Query(1,ge=1), limit: int = Query(30,ge=1,le=100),
    order: Literal['newest','oldest'] = 'newest', db: Session = Depends(get_db), user: User = Depends(current_user)):
    exam = domain.exam_access(db,exam_id,user)
    query = select(DetectionEvent,User,ExamAttempt).select_from(DetectionEvent).join(ExamAttempt,ExamAttempt.id==DetectionEvent.attempt_id).join(User,User.id==ExamAttempt.student_id).where(*event_scope(exam_id,simulated))
    if status: query=query.where(DetectionEvent.status==status)
    if priority: query=query.where(DetectionEvent.severity.in_(['high','critical']))
    if event_type: query=query.where(DetectionEvent.event_type==event_type)
    if attempt_id: query=query.where(DetectionEvent.attempt_id==attempt_id)
    if q:
        term='%' + q.replace('\\','\\\\').replace('%','\\%').replace('_','\\_') + '%'
        query=query.where(or_(User.full_name.ilike(term,escape='\\'),User.student_code.ilike(term,escape='\\')))
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    query = query.order_by(DetectionEvent.last_seen.desc() if order=='newest' else DetectionEvent.last_seen.asc(),DetectionEvent.id)
    rows = db.execute(query.offset((page-1)*limit).limit(limit)).all()
    # Totals cover the complete attempt/type history, not just this page or
    # the 15-second aggregation window. No double-counted browser mirrors.
    attempt_ids = {row.attempt_id for row, _, _ in rows}
    type_totals = {}
    if attempt_ids:
        type_totals = {(attempt, kind): int(count) for attempt, kind, count in db.execute(
            select(DetectionEvent.attempt_id, DetectionEvent.event_type, func.sum(DetectionEvent.occurrence_count))
            .where(DetectionEvent.attempt_id.in_(attempt_ids), DetectionEvent.is_simulated == simulated,
                   DetectionEvent.provider != 'browser_signals')
            .group_by(DetectionEvent.attempt_id, DetectionEvent.event_type))}
    types=db.scalars(select(DetectionEvent.event_type).where(*event_scope(exam_id,simulated)).distinct().order_by(DetectionEvent.event_type).limit(128)).all()
    return {'data':[{**domain.serialize(db,row,attempt=attempt,student=student),
        'type_occurrence_count':type_totals.get((row.attempt_id, row.event_type), row.occurrence_count)}
        for row,student,attempt in rows], 'meta':{'total':total,'page':page,'limit':limit,
        'event_types':types,
        'summary':operational_summary(db,exam,simulated),'exam':{'id':exam.id,'title':exam.title,'status':exam.status,'start_time':exam.start_time,'end_time':exam.end_time}}}


@router.get('/events/{event_id}')
def event_detail(event_id: UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = domain.event_access(db,event_id,user)
    exam=db.get(Exam,db.get(ExamAttempt,row.attempt_id).exam_id)
    return ok({**domain.serialize(db,row),'exam':{'id':exam.id,'title':exam.title},'history':domain.review_history(db,row)})


@router.get('/events/{event_id}/evidence')
def legacy_evidence(event_id: UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    import re
    row=domain.event_access(db,event_id,user)
    match=re.fullmatch(r'/uploads/([0-9a-f]{32}\.(jpg|png|webp))',row.snapshot_url or '') if row.source=='LEGACY' else None
    if not match: domain.fail(404,'EVIDENCE_NOT_FOUND','No stored snapshot is available.')
    from app.api.media import file_at
    from app.services.snapshots import UPLOAD_DIR
    return file_at(UPLOAD_DIR,match.group(1),{'jpg':'image/jpeg','png':'image/png','webp':'image/webp'}[match.group(2)])


@router.patch('/events/{event_id}/review')
async def review_event(event_id: UUID, payload: ReviewEvent, db: Session = Depends(get_db), user: User = Depends(current_user)):
    def save():
        try:
            row,changed = domain.review(db,event_id,user,payload)
            message = realtime.change(db,row,'proctor_event_reviewed') if changed else None
            db.commit()
            exam=db.get(Exam,db.get(ExamAttempt,row.attempt_id).exam_id)
            return ok({**domain.serialize(db,row),'exam':{'id':exam.id,'title':exam.title},'history':domain.review_history(db,row)}),message
        except Exception:
            db.rollback(); raise
    result,message=await run_in_threadpool(save)
    await realtime.after_commit(db,message)
    return result


@router.get('/exams/{exam_id}/report')
def event_report(exam_id: UUID, simulated: bool = False, page: int = Query(1, ge=1), limit: int = Query(30, ge=1, le=100),
    q: str = Query('', max_length=120), alert_filter: Literal['all','with_alerts','unresolved','new','confirmed','dismissed'] = 'all',
    severity: Literal['info','low','medium','high','critical'] | None = None,
    db: Session = Depends(get_db), user: User = Depends(current_user)):
    exam = domain.exam_access(db,exam_id,user)
    scope = event_scope(exam_id,simulated)
    types = db.execute(select(DetectionEvent.event_type,func.count()).where(*scope).group_by(DetectionEvent.event_type).order_by(func.count().desc(),DetectionEvent.event_type)).all()
    pending = db.execute(select(User.id,User.full_name,User.student_code,func.count()).join(DetectionEvent,DetectionEvent.student_id==User.id)
        .where(*scope,DetectionEvent.status.in_(['NEW','REVIEWED'])).group_by(User.id,User.full_name,User.student_code).order_by(func.count().desc(),User.full_name,User.id)).all()
    from app.services.monitoring_reports import attempt_report
    return ok({'exam_id':exam.id,'exam_title':exam.title,'is_simulated':simulated,'summary':operational_summary(db,exam,simulated),
        **attempt_report(db,exam,simulated,page=page,limit=limit,q=q,alert_filter=alert_filter,severity=severity),
        'types':[{'event_type':kind,'count':count} for kind,count in types],
        'students_requiring_review':[{'id':sid,'full_name':name,'student_code':code,'count':count} for sid,name,code,count in pending]})


@router.get('/attempts/{attempt_id}/timeline')
def timeline(attempt_id: UUID, simulated: bool = False, exam_id: UUID | None = None, page: int = Query(1, ge=1),
    db: Session = Depends(get_db), user: User = Depends(current_user)):
    attempt=db.get(ExamAttempt,attempt_id)
    if not attempt: domain.fail(404,'NOT_FOUND','Attempt not found.')
    if exam_id and attempt.exam_id != exam_id: domain.fail(404,'NOT_FOUND','Attempt does not belong to this exam.')
    exam=domain.exam_access(db,attempt.exam_id,user)
    student=db.get(User,attempt.student_id)
    query=select(DetectionEvent).where(DetectionEvent.exam_id==exam.id,DetectionEvent.attempt_id==attempt.id,DetectionEvent.is_simulated==simulated)
    total=db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows=db.scalars(query.order_by(DetectionEvent.occurred_at.asc(),DetectionEvent.id).offset((page-1)*100).limit(100)).all()
    entries=[]
    if attempt.started_at: entries.append({'id':'started','kind':'started','at':attempt.started_at,'label':'Bắt đầu bài thi'})
    if attempt.submitted_at: entries.append({'id':'submitted','kind':'submitted','at':attempt.submitted_at,'label':'Nộp bài' if attempt.status!=AttemptStatus.terminated else 'Lượt thi đã kết thúc'})
    for row in rows:
        entries.append({'id':row.id,'kind':'event','at':row.occurred_at,'label':row.message or row.event_type,'event':domain.serialize(db,row,attempt=attempt,student=student)})
    if rows:
        history=db.execute(select(AuditLog,User.full_name).outerjoin(User,User.id==AuditLog.user_id).where(
            AuditLog.entity_type=='proctor_event',AuditLog.entity_id.in_([row.id for row in rows]),
            AuditLog.action!='proctor_event_generated').order_by(AuditLog.created_at.desc(),AuditLog.id).limit(200)).all()
        for audit,name in history:
            entries.append({'id':audit.id,'kind':'review','at':audit.created_at,'event_id':audit.entity_id,
                'status':(audit.metadata_json or {}).get('to'),'actor':name,'note':(audit.metadata_json or {}).get('note')})
    entries.sort(key=lambda item:(domain.utc(item['at']),str(item['id'])))
    summary={'total':total,'new':0,'reviewed':0,'confirmed':0,'dismissed':0,'highest_severity':None}
    priorities={'info':1,'low':2,'medium':3,'high':4,'critical':5}
    for status,severity,count in db.execute(select(DetectionEvent.status,DetectionEvent.severity,func.count()).where(
        DetectionEvent.exam_id==exam.id,DetectionEvent.attempt_id==attempt.id,DetectionEvent.is_simulated==simulated
    ).group_by(DetectionEvent.status,DetectionEvent.severity)):
        summary[status.lower()]+=count
        value=severity.value
        if priorities[value]>priorities.get(summary['highest_severity'],0):summary['highest_severity']=value
    session=db.scalar(select(ProctoringSession).where(ProctoringSession.attempt_id==attempt.id,ProctoringSession.deleted_at.is_(None)))
    from app.api.v1.proctoring import RECORDING_DIR
    recording_path=RECORDING_DIR / f'{attempt.id}.webm'
    recording_url=(session.full_recording_url if session and session.full_recording_url==f'/uploads/recordings/{attempt.id}.webm'
        and recording_path.is_file() and recording_path.stat().st_size>0 else None)
    return ok({'attempt_id':attempt.id,'exam_id':exam.id,'student':{'id':student.id,'full_name':student.full_name,'student_code':student.student_code},
        'status':attempt.status,'started_at':attempt.started_at,'submitted_at':attempt.submitted_at,
        'recording_url':recording_url,'entries':entries,'total_events':total,'truncated':page*100<total,'page':page,'summary':summary})


@router.websocket('/ws')
async def monitoring_socket(websocket: WebSocket, db: Session = Depends(get_db)):
    await realtime.socket(websocket,db)


def student_attempt(db, attempt_id, user, *, active=True):
    attempt = db.get(ExamAttempt,attempt_id)
    if user.role != UserRole.student or not attempt or attempt.student_id != user.id:
        domain.fail(403,'FORBIDDEN','You cannot provide input for this attempt.')
    exam = db.get(Exam,attempt.exam_id)
    now=datetime.now(timezone.utc)
    if active and (attempt.status!=AttemptStatus.in_progress or not attempt.server_deadline_at or now>domain.utc(attempt.server_deadline_at)
        or not exam or exam.deleted_at or exam.status not in (ExamStatus.published,ExamStatus.ongoing) or now<domain.utc(exam.start_time) or now>domain.utc(exam.end_time)):
        domain.fail(409,'ATTEMPT_INACTIVE','The attempt is no longer active.')
    return attempt,exam


@router.get('/sessions/{attempt_id}/input-capabilities')
def input_capabilities(attempt_id: UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _,exam=student_attempt(db,attempt_id,user)
    models=configured_models() if exam.require_camera else []
    calibration_enabled=settings.ENVIRONMENT.lower() in {'development','dev','local'} and settings.PROCTOR_GAZE_CALIBRATION
    diagnostic('capabilities', camera_required=exam.require_camera, model_enabled=settings.PROCTOR_MODEL_ENABLED,
        providers=[provider for provider,_,_ in models])
    result={'enabled':bool(models),'frame_interval_ms':min(profile.frame_interval_ms for _,profile,_ in models) if models else None,
        'gaze_calibration_enabled':calibration_enabled}
    if settings.PROCTOR_DIAGNOSTICS: result['diagnostics_enabled']=True
    return ok(result)


@router.get('/sessions/{attempt_id}/warnings')
def student_warnings(attempt_id: UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Owner-only feedback; evidence, confidence and teacher review notes stay private."""
    student_attempt(db, attempt_id, user)
    rows = db.scalars(select(DetectionEvent).where(
        DetectionEvent.attempt_id == attempt_id,
        DetectionEvent.is_simulated.is_(False),
        DetectionEvent.provider != 'browser_signals',
        DetectionEvent.status != 'DISMISSED',
    ).order_by(DetectionEvent.last_seen.desc(), DetectionEvent.id).limit(20)).all()
    type_totals = {kind: int(count) for kind, count in db.execute(
        select(DetectionEvent.event_type, func.sum(DetectionEvent.occurrence_count)).where(
            DetectionEvent.attempt_id == attempt_id, DetectionEvent.is_simulated.is_(False),
            DetectionEvent.provider != 'browser_signals')
        .group_by(DetectionEvent.event_type))}
    return ok([{'id': str(row.id), 'event_type': row.event_type,
                'occurred_at': row.last_seen or row.occurred_at,
                'occurrence_count': row.occurrence_count,
                'type_occurrence_count': type_totals.get(row.event_type, row.occurrence_count),
                # The Student may see the direction of their own warning, but
                # not model confidences, evidence frames or teacher review notes.
                **({'direction_label': row.message}
                   if row.provider == 'local_gaze' and row.event_type in ('gaze_away', 'head_turned')
                   and row.message else {})}
               for row in rows])


@router.post('/sessions/{attempt_id}/frame')
async def camera_frame(attempt_id: UUID, request: Request, frame: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(current_user)):
    # An ephemeral correlation ID never contains an attempt/student identifier.
    try: trace=str(UUID(request.headers.get('x-proctor-trace','')))
    except ValueError: trace=str(uuid4())
    def prepare():
        attempt,exam=student_attempt(db,attempt_id,user)
        session=db.scalar(select(ProctoringSession).where(ProctoringSession.attempt_id==attempt.id,ProctoringSession.deleted_at.is_(None)))
        if not exam.require_camera or not session or not session.camera_enabled:
            domain.fail(409,'CAMERA_SESSION_REQUIRED','An existing enabled camera session is required.')
        if not configured_models(): domain.fail(503,'MODEL_DISABLED','No monitoring model is connected.')
        context=AdapterContext(attempt.exam_id,attempt.id,attempt.student_id)
        db.rollback()  # No transaction/connection while awaiting inference.
        return context
    try: context=await run_in_threadpool(prepare)
    except HTTPException as error:
        diagnostic('frame_rejected', trace=trace, status=error.status_code, code=error.detail.get('code') if isinstance(error.detail,dict) else None)
        raise
    try: content=await frame.read(1024*1024+1)
    finally: await frame.close()
    if len(content)>1024*1024: domain.fail(413,'FRAME_TOO_LARGE','Frame exceeds the input limit.')
    if frame.content_type not in {'image/jpeg','image/png'}: domain.fail(415,'INVALID_FRAME','Only JPEG/PNG input is accepted.')
    try:
        from io import BytesIO
        from PIL import Image
        with Image.open(BytesIO(content)) as image:
            if image.format not in {'JPEG','PNG'} or image.width*image.height>2000000: raise ValueError('Invalid dimensions')
            image.verify()
    except Exception:
        domain.fail(422,'INVALID_FRAME','Invalid monitoring image.')
    diagnostic('frame_received', trace=trace, content_type=frame.content_type, bytes=len(content))
    events,states=await runtime.process_frame(context,MonitoringFrame(content,frame.content_type,datetime.now(timezone.utc),trace))
    def save():
        changes=[]
        try:
            _,exam=student_attempt(db,attempt_id,user)  # Recheck submit/expiry during inference.
            for event in events[:32]:
                result=domain.ingest(db,event)
                diagnostic('event_persistence', trace=trace, event_type=event.event_type, created=result.created,
                    duplicate=result.duplicate, suppressed=result.suppressed)
                if result.event and not result.duplicate:
                    changes.append(realtime.change(db,result.event,'proctor_event_created' if result.created else 'proctor_event_updated'))
            for provider,state,code in states:
                if provider and domain.touch_health(db,provider,state,code): changes.append(realtime.health_change(db,provider,exam))
            db.commit()
            diagnostic('frame_committed', trace=trace, changes=len(changes))
            return changes
        except Exception:
            db.rollback(); raise
    try: changes=await run_in_threadpool(save)
    except HTTPException as error:
        if error.status_code==409: await runtime.stop(attempt_id)
        raise
    for message in changes: await realtime.after_commit(db,message)
    # A student receives transport acknowledgement only, never alerts/confidence/review state.
    response={'processed':not states or any(state == 'ACTIVE' for _,state,_ in states)}
    diagnostic('frame_ack', trace=trace, processed=response['processed'], states=[(provider,state,code) for provider,state,code in states])
    if settings.ENVIRONMENT.lower() in {'development','dev','local'} and settings.PROCTOR_GAZE_CALIBRATION:
        response['gaze_calibration_sample']=runtime.calibration_sample(attempt_id)
    return ok(response)


@router.delete('/sessions/{attempt_id}/input')
async def stop_input(attempt_id: UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    await run_in_threadpool(student_attempt,db,attempt_id,user,active=False)
    await runtime.stop(attempt_id)
    return ok({'stopped':True})


class ModelHeartbeat(BaseModel):
    model_config = ConfigDict(extra='forbid')
    status: Literal['ACTIVE','DEGRADED','UNAVAILABLE']
    error_code: Literal['MODEL_TIMEOUT','MODEL_UNAVAILABLE','INVALID_MODEL_OUTPUT'] | None = None


@router.post('/modules/{provider}/heartbeat', dependencies=[Depends(trusted_ingestor)])
async def heartbeat(provider: str, body: ModelHeartbeat, db: Session = Depends(get_db)):
    domain.model_config(provider)
    def save():
        try:
            message=realtime.health_change(db,provider) if domain.touch_health(db,provider,body.status,body.error_code) else None
            db.commit();return message
        except Exception:
            db.rollback();raise
    message=await run_in_threadpool(save)
    await realtime.after_commit(db,message)
    return ok({'accepted':True})
