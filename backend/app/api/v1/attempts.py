import random
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session
from app.services.collections import search, ordered, page_query
from sqlalchemy import case

from app.api.deps import current_user
from app.api.responses import ok
from app.core.database import get_db
from app.models.entities import (
    Answer, AttemptStatus, Class, ClassEnrollment, Exam, ExamAssignment, ExamAttempt,
    DetectionEvent, ExamQuestion, ProctoringSession, Question, User, UserRole, ViolationLog,
    SeverityLevel,
)
from app.schemas.attempts import AnswerSave, AttemptStart
from app.schemas.content import QuestionForStudent, QuestionForTeacher, student_safe_options
from app.services.attempts import finalize_expired_attempt
from app.services.student_exam_state import student_result_metadata, student_result_metadata_many
from app.services.grading import grade_attempt
from app.services.question_types import SUPPORTED_QUESTION_TYPES, require_supported_exam, unsupported_question_type
from app.services.audit import record_audit
from app.services.notifications import notify_teachers_of_exam
from app.services.exam_entry import consume_entry_verification
import logging

logger = logging.getLogger('app.audit')

router = APIRouter()


def _error(code: str, message: str, http_status: int) -> HTTPException:
    return HTTPException(http_status, detail={'code': code, 'message': message, 'details': None})


def _not_found(message: str = 'Attempt not found') -> HTTPException:
    return _error('NOT_FOUND', message, 404)


def _assigned(db: Session, exam_id: UUID, student_id: UUID) -> bool:
    return db.scalar(select(ExamAssignment.id).where(
        ExamAssignment.exam_id == exam_id,
        or_(
            ExamAssignment.student_id == student_id,
            ExamAssignment.class_id.in_(
                select(ClassEnrollment.class_id).where(ClassEnrollment.student_id == student_id)
            ),
        ),
    ).limit(1)) is not None


def _can_view(db: Session, attempt: ExamAttempt, user: User) -> bool:
    if user.role == UserRole.admin or attempt.student_id == user.id:
        return True
    exam = db.get(Exam, attempt.exam_id)
    return user.role == UserRole.teacher and exam is not None and exam.created_by == user.id


def _assert_viewable(attempt: ExamAttempt | None, user: User, db: Session) -> ExamAttempt:
    if not attempt or not _can_view(db, attempt, user):
        raise _not_found()
    return attempt


def _deadline(attempt: ExamAttempt) -> datetime | None:
    if not attempt.server_deadline_at:
        return None
    if attempt.server_deadline_at.tzinfo is None:
        return attempt.server_deadline_at.replace(tzinfo=timezone.utc)
    return attempt.server_deadline_at


def _ordered_links(db: Session, attempt: ExamAttempt) -> list[tuple[ExamQuestion, Question]]:
    links = db.scalars(select(ExamQuestion).where(ExamQuestion.exam_id == attempt.exam_id)).all()
    questions = {question.id: question for question in db.scalars(
        select(Question).where(Question.id.in_([link.question_id for link in links]))
    ).all()}
    saved = attempt.question_order_json or {}
    order = saved.get('question_ids') if isinstance(saved, dict) else None
    by_id = {link.question_id: link for link in links}
    ordered: list[tuple[ExamQuestion, Question]] = []
    if order:
        for question_id in order:
            try:
                question_uuid = UUID(question_id)
            except (TypeError, ValueError):
                continue
            if question_uuid in by_id and question_uuid in questions:
                ordered.append((by_id[question_uuid], questions[question_uuid]))
    for link in sorted(links, key=lambda row: row.order_index):
        if link.question_id in questions and all(link.question_id != existing[1].id for existing in ordered):
            ordered.append((link, questions[link.question_id]))
    return ordered


def _serialize_question(question: Question, link: ExamQuestion, attempt: ExamAttempt, student: bool) -> dict:
    schema = QuestionForStudent if student else QuestionForTeacher
    data = schema.model_validate(question).model_dump(mode='json')
    if student:
        data['options_json'] = student_safe_options(data.get('options_json'))
    saved = attempt.question_order_json or {}
    option_orders = saved.get('option_orders', {}) if isinstance(saved, dict) else {}
    indices = option_orders.get(str(question.id))
    if indices and isinstance(data.get('options_json'), dict) and isinstance(data['options_json'].get('options'), list):
        options = data['options_json']['options']
        data['options_json'] = {**data['options_json'], 'options': [options[index] for index in indices if index < len(options)]}
    data.update({'order_index': link.order_index, 'points': link.points})
    return data


def _attempt_summaries(db: Session, attempts: list[ExamAttempt], user: User) -> dict:
    result = {'answers': {}, 'sessions': {}, 'students': {}, 'violations': {}, 'metadata': {}}
    ids = [item.id for item in attempts]
    if not ids:
        return result
    for answer in db.scalars(select(Answer).where(Answer.attempt_id.in_(ids))):
        result['answers'].setdefault(answer.attempt_id, []).append(answer)
    for session in db.scalars(select(ProctoringSession).where(ProctoringSession.attempt_id.in_(ids))):
        result['sessions'].setdefault(session.attempt_id, session)
    result['students'] = {student.id: student for student in db.scalars(select(User).where(User.id.in_({item.student_id for item in attempts})))}
    for model in (ViolationLog, DetectionEvent):
        # Normalized browser envelopes reference the original ViolationLog;
        # academic summaries count that signal once, as the detail endpoint does.
        source_scope = [DetectionEvent.source == 'LEGACY'] if model is DetectionEvent else []
        for attempt_id, count in db.execute(select(model.attempt_id, func.count()).where(model.attempt_id.in_(ids), *source_scope).group_by(model.attempt_id)):
            result['violations'][attempt_id] = result['violations'].get(attempt_id, 0) + count
    if user.role == UserRole.student:
        result['metadata'] = student_result_metadata_many(db, attempts)
    return result


def _serialize_attempt(db: Session, attempt: ExamAttempt, user: User, include_questions: bool = True, summary=None) -> dict:
    now = datetime.now(timezone.utc)
    deadline = _deadline(attempt)
    remaining = max(0, int((deadline - now).total_seconds())) if deadline and attempt.status == AttemptStatus.in_progress else 0
    # The student representation is always safe to return: questions are
    # serialized through QuestionForStudent and answer grading fields are
    # masked below.  This also lets a student reload a submitted attempt and
    # still see the answers that were saved before the deadline.
    answers = summary['answers'].get(attempt.id, []) if summary is not None else db.scalars(select(Answer).where(Answer.attempt_id == attempt.id)).all()
    session = summary['sessions'].get(attempt.id) if summary is not None else db.scalar(select(ProctoringSession).where(ProctoringSession.attempt_id == attempt.id))
    student = summary['students'].get(attempt.student_id) if summary is not None else db.get(User, attempt.student_id)
    data = {
        'id': attempt.id, 'exam_id': attempt.exam_id, 'student_id': attempt.student_id,
        'attempt_number': attempt.attempt_number, 'started_at': attempt.started_at,
        'server_deadline_at': attempt.server_deadline_at, 'submitted_at': attempt.submitted_at,
        'status': attempt.status, 'score': attempt.score, 'max_score': attempt.max_score,
        'violation_count': summary['violations'].get(attempt.id, 0) if summary is not None else (db.scalar(select(func.count()).select_from(ViolationLog).where(ViolationLog.attempt_id == attempt.id)) or 0)
                           + (db.scalar(select(func.count()).select_from(DetectionEvent).where(DetectionEvent.attempt_id == attempt.id, DetectionEvent.source == 'LEGACY')) or 0),
        'risk_score': attempt.risk_score,
        'remaining_seconds': remaining, 'server_now': now,
        'recording_url': session.full_recording_url if session else None,
        'student': None if not student else {'id': student.id, 'full_name': student.full_name, 'email': student.email,'student_code':student.student_code},
        'answers': [{
            'id': answer.id, 'question_id': answer.question_id, 'answer_content': answer.answer_content,
            'is_correct': answer.is_correct if user.role != UserRole.student else None,
            'points_awarded': answer.points_awarded if user.role != UserRole.student else None,
            'answered_at': answer.answered_at, 'saved_at': answer.answered_at,
        } for answer in answers],
    }
    if user.role == UserRole.student:
        data.update(summary['metadata'][attempt.id] if summary is not None else student_result_metadata(db, attempt))
    if include_questions:
        data['questions'] = [
            _serialize_question(question, link, attempt, user.role == UserRole.student)
            for link, question in _ordered_links(db, attempt)
        ]
    return data


def _finalize_if_expired(db: Session, attempt: ExamAttempt) -> bool:
    changed = finalize_expired_attempt(db, attempt)
    if changed:
        db.commit()
        db.refresh(attempt)
    return changed


@router.get('')
def list_attempts(
    exam_id: UUID = Query(...), page: int = Query(1,ge=1), limit: int = Query(50,ge=1,le=100),
    q: str=Query('',max_length=255), status: AttemptStatus|None=None, has_warnings:bool|None=None, severity:SeverityLevel|None=None,
    sort:str='newest',risk_min:float|None=Query(None,ge=0,le=100),completed_only:bool=False,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    if user.role not in (UserRole.admin, UserRole.teacher):
        raise _error('FORBIDDEN', 'Only teacher or admin can list exam attempts', 403)
    exam = db.get(Exam, exam_id)
    if not exam or (user.role == UserRole.teacher and exam.created_by != user.id):
        raise _not_found('Exam not found')
    expired=db.scalars(select(ExamAttempt).where(ExamAttempt.exam_id==exam_id,ExamAttempt.status==AttemptStatus.in_progress,ExamAttempt.server_deadline_at < func.now())).all()
    for attempt in expired:_finalize_if_expired(db,attempt)
    limit = max(1, min(limit, 100))
    query = search(select(ExamAttempt).join(User,User.id == ExamAttempt.student_id).where(ExamAttempt.exam_id == exam_id),q,User.full_name,User.student_code,User.email)
    if status: query=query.where(ExamAttempt.status == status)
    if completed_only: query=query.where(ExamAttempt.status.in_((AttemptStatus.submitted,AttemptStatus.auto_submitted,AttemptStatus.terminated)))
    if risk_min is not None: query=query.where(ExamAttempt.risk_score >= risk_min)
    browser=select(ViolationLog.id).where(ViolationLog.attempt_id == ExamAttempt.id)
    detector=select(DetectionEvent.id).where(DetectionEvent.attempt_id == ExamAttempt.id, DetectionEvent.source == 'LEGACY')
    if severity: query=query.where(or_(browser.where(ViolationLog.severity == severity).exists(),detector.where(DetectionEvent.severity == severity).exists()))
    if has_warnings is not None:
        warnings=or_(browser.exists(),detector.exists())
        query=query.where(warnings if has_warnings else ~warnings)
    warning_count=select(func.count()).select_from(ViolationLog).where(ViolationLog.attempt_id == ExamAttempt.id).scalar_subquery()+select(func.count()).select_from(DetectionEvent).where(DetectionEvent.attempt_id == ExamAttempt.id, DetectionEvent.source == 'LEGACY').scalar_subquery()
    scope=query.subquery()
    count_data=db.execute(select(func.sum(case((scope.c.status == AttemptStatus.in_progress,1),else_=0)),
                                func.sum(case((scope.c.status.in_((AttemptStatus.submitted,AttemptStatus.auto_submitted,AttemptStatus.terminated)),1),else_=0)),
                                func.sum(case((scope.c.status == AttemptStatus.not_started,1),else_=0)))).one()
    warning_students=db.scalar(select(func.count()).select_from(query.where(or_(browser.exists(),detector.exists())).subquery())) or 0
    query=ordered(query,sort,{'newest':ExamAttempt.created_at.desc(),'oldest':ExamAttempt.created_at.asc(),'name':func.lower(User.full_name).asc(),'risk':ExamAttempt.risk_score.desc().nullslast(),'violations':warning_count.desc(),'submitted':ExamAttempt.submitted_at.desc().nullslast()},ExamAttempt.id)
    query,total=page_query(db,query,page,limit)
    attempts = db.scalars(query).all()
    for attempt in attempts:
        _finalize_if_expired(db, attempt)
    summary = _attempt_summaries(db, attempts, user)
    result=ok([_serialize_attempt(db, attempt, user, include_questions=False, summary=summary) for attempt in attempts], total=total, page=page, limit=limit)
    result['meta']['summary']=dict(zip(('working','submitted','not_started'),(value or 0 for value in count_data)))|{'violations':warning_students}
    return result


@router.get('/mine')
def list_my_attempts(
    exam_id: UUID | None = Query(default=None), page: int = Query(1,ge=1), limit: int = Query(100,ge=1,le=100),
    q:str=Query('',max_length=255), status:AttemptStatus|None=None, completed_only:bool=False,
    from_time:datetime|None=None,to_time:datetime|None=None, class_id:UUID|None=None,sort:str='newest',time_field:str='submitted',
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    """Student-owned attempts for the learning area/history pages."""
    if user.role != UserRole.student:
        raise _error('FORBIDDEN', 'Only students can list their own attempts', 403)
    query = search(select(ExamAttempt).join(Exam,Exam.id == ExamAttempt.exam_id).where(ExamAttempt.student_id == user.id),q,Exam.title)
    if exam_id is not None:
        query = query.where(ExamAttempt.exam_id == exam_id)
    expired=db.scalars(query.where(ExamAttempt.status == AttemptStatus.in_progress,ExamAttempt.server_deadline_at < func.now())).all()
    for attempt in expired: _finalize_if_expired(db,attempt)
    if status: query=query.where(ExamAttempt.status == status)
    if completed_only: query=query.where(ExamAttempt.status.in_((AttemptStatus.submitted,AttemptStatus.auto_submitted,AttemptStatus.terminated)))
    if time_field not in ('submitted', 'started'):
        raise _error('INVALID_TIME_FIELD', 'Unsupported attempt time field', 422)
    timestamp = ExamAttempt.started_at if time_field == 'started' else ExamAttempt.submitted_at
    if from_time: query=query.where(timestamp >= from_time)
    if to_time: query=query.where(timestamp <= to_time)
    if class_id: query=query.where(Exam.id.in_(select(ExamAssignment.exam_id).where(ExamAssignment.class_id == class_id)))
    query=ordered(query,sort,{'newest':ExamAttempt.created_at.desc(),'oldest':ExamAttempt.created_at.asc(),'started':ExamAttempt.started_at.desc().nullslast(),'submitted':ExamAttempt.submitted_at.desc().nullslast(),'score_desc':ExamAttempt.score.desc().nullslast(),'score_asc':ExamAttempt.score.asc().nullslast()},ExamAttempt.id)
    query,total=page_query(db,query,page,limit)
    rows = db.scalars(query).all()
    for row in rows:
        _finalize_if_expired(db, row)
    summary = _attempt_summaries(db, rows, user)
    exam_ids = {row.exam_id for row in rows}
    exams = {exam.id: exam for exam in db.scalars(select(Exam).where(Exam.id.in_(exam_ids)))} if rows else {}
    classes_by_exam = {}
    if rows:
        for item in db.execute(select(ExamAssignment.exam_id, Class.id, Class.name).join(Class, Class.id == ExamAssignment.class_id).where(ExamAssignment.exam_id.in_(exam_ids))):
            classes_by_exam.setdefault(item.exam_id, []).append({'id': item.id, 'name': item.name})
    data=[]
    for row in rows:
        exam=exams.get(row.exam_id)
        data.append({**_serialize_attempt(db,row,user,include_questions=False,summary=summary),'exam_title':exam.title if exam else None,'classes':classes_by_exam.get(row.exam_id, [])})
    return ok(data, total=total, page=page, limit=limit)


@router.post('')
@router.post('/start', include_in_schema=False)
def start(payload: AttemptStart, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if user.role != UserRole.student:
        raise _error('FORBIDDEN', 'Only students can start an attempt', 403)
    # The row lock makes two simultaneous F5/start requests serialize on PostgreSQL.
    exam = db.scalar(select(Exam).where(Exam.id == payload.exam_id).with_for_update())
    if not exam or exam.deleted_at is not None:
        raise _not_found('Exam not found')
    if not _assigned(db, exam.id, user.id):
        raise _error('FORBIDDEN', 'You are not assigned to this exam', 403)
    require_supported_exam(db, exam.id)
    now = datetime.now(timezone.utc)
    start_time = exam.start_time if exam.start_time.tzinfo else exam.start_time.replace(tzinfo=timezone.utc)
    end_time = exam.end_time if exam.end_time.tzinfo else exam.end_time.replace(tzinfo=timezone.utc)
    if now < start_time or now > end_time:
        raise _error('EXAM_NOT_AVAILABLE', 'The exam is outside its allowed time window', 403)
    if exam.require_camera and payload.entry_verification_id is None:
        consume_entry_verification(db, user, exam.id, None)  # Reject historical success alone.
    in_progress = db.scalar(select(ExamAttempt).where(
        ExamAttempt.exam_id == exam.id, ExamAttempt.student_id == user.id,
        ExamAttempt.status == AttemptStatus.in_progress,
    ).order_by(ExamAttempt.attempt_number.desc()).limit(1))
    if payload.resume_attempt_id and (in_progress is None or in_progress.id != payload.resume_attempt_id):
        raise _error('ATTEMPT_NOT_IN_PROGRESS', 'Lượt thi không còn hoạt động. Vui lòng tải lại trang.', 409)
    if in_progress:
        if _finalize_if_expired(db, in_progress):
            if payload.resume_attempt_id:
                raise _error('ATTEMPT_EXPIRED', 'Lượt thi đã hết thời gian. Vui lòng xem kết quả.', 409)
            # Finalization commits and releases locks. Re-enter under a fresh exam
            # lock before checking/consuming proof or creating another attempt.
            return start(payload, db, user)
        else:
            if exam.require_camera:
                consume_entry_verification(db, user, exam.id, payload.entry_verification_id)
            if exam.require_camera and not db.scalar(select(ProctoringSession.id).where(ProctoringSession.attempt_id == in_progress.id)):
                db.add(ProctoringSession(attempt_id=in_progress.id, camera_enabled=True, mic_enabled=True, started_at=now))
            db.commit()  # Consume the entry proof even when resuming an existing attempt.
            return ok(_serialize_attempt(db, in_progress, user))
    attempt_count = db.scalar(select(func.count()).select_from(ExamAttempt).where(
        ExamAttempt.exam_id == exam.id, ExamAttempt.student_id == user.id,
    )) or 0
    if attempt_count >= exam.max_attempts:
        raise _error('MAX_ATTEMPTS_REACHED', 'Maximum attempts for this exam has been reached', 409)
    if exam.require_camera:
        now = consume_entry_verification(db, user, exam.id, payload.entry_verification_id)
        if now > end_time:
            raise _error('EXAM_NOT_AVAILABLE', 'The exam is outside its allowed time window', 403)
    links = db.scalars(select(ExamQuestion).where(ExamQuestion.exam_id == exam.id).order_by(ExamQuestion.order_index)).all()
    question_ids = [str(link.question_id) for link in links]
    if exam.shuffle_questions:
        random.SystemRandom().shuffle(question_ids)
    option_orders: dict[str, list[int]] = {}
    if exam.shuffle_options:
        for question in db.scalars(select(Question).where(Question.id.in_([link.question_id for link in links]))).all():
            options = question.options_json.get('options') if isinstance(question.options_json, dict) else None
            if isinstance(options, list):
                indices = list(range(len(options)))
                random.SystemRandom().shuffle(indices)
                option_orders[str(question.id)] = indices
    attempt = ExamAttempt(
        exam_id=exam.id, student_id=user.id, attempt_number=attempt_count + 1,
        status=AttemptStatus.in_progress, started_at=now,
        server_deadline_at=now + timedelta(minutes=exam.duration_minutes),
        question_order_json={'question_ids': question_ids, 'option_orders': option_orders},
    )
    db.add(attempt)
    db.flush()
    record_audit(db, action='attempt_started', user_id=user.id, entity_type='attempt', entity_id=attempt.id, metadata={'exam_id': str(exam.id)})
    db.commit()
    db.refresh(attempt)
    logger.info('attempt_started', extra={'attempt_id': str(attempt.id), 'exam_id': str(attempt.exam_id), 'student_id': str(user.id)})
    if exam.require_camera:
        db.add(ProctoringSession(attempt_id=attempt.id, camera_enabled=True, mic_enabled=True, started_at=now))
        db.commit()
    return ok(_serialize_attempt(db, attempt, user))


@router.get('/{attempt_id}')
def get_attempt(attempt_id: UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    attempt = _assert_viewable(db.get(ExamAttempt, attempt_id), user, db)
    _finalize_if_expired(db, attempt)
    if user.role == UserRole.student and attempt.status == AttemptStatus.in_progress:
        require_supported_exam(db, attempt.exam_id)
    return ok(_serialize_attempt(db, attempt, user))


@router.get('/{attempt_id}/questions')
def get_attempt_questions(attempt_id: UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    attempt = _assert_viewable(db.get(ExamAttempt, attempt_id), user, db)
    _finalize_if_expired(db, attempt)
    if user.role == UserRole.student and attempt.status == AttemptStatus.in_progress:
        require_supported_exam(db, attempt.exam_id)
    return ok([
        _serialize_question(question, link, attempt, user.role == UserRole.student)
        for link, question in _ordered_links(db, attempt)
    ])


@router.get('/{attempt_id}/timeline')
def get_attempt_timeline(attempt_id: UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    attempt = _assert_viewable(db.get(ExamAttempt, attempt_id), user, db)
    _finalize_if_expired(db, attempt)
    violations = db.scalars(select(ViolationLog).where(ViolationLog.attempt_id == attempt.id)).all()
    detections = db.scalars(select(DetectionEvent).where(DetectionEvent.attempt_id == attempt.id, DetectionEvent.source == 'LEGACY')).all()
    timeline = [
        {'id': row.id, 'kind': 'violation', 'type': row.type, 'severity': row.severity,
         'metadata_json': row.metadata_json, 'occurred_at': row.occurred_at}
        for row in violations
    ] + [
        {'id': row.id, 'kind': 'detection_event', 'type': row.event_type, 'severity': row.severity,
         'confidence_score': row.confidence_score, 'snapshot_url': row.snapshot_url,
         'metadata_json': row.metadata_json, 'occurred_at': row.occurred_at}
        for row in detections
    ]
    timeline.sort(key=lambda row: row['occurred_at'])
    return ok(timeline)


def _writable_attempt(attempt_id: UUID, db: Session, user: User) -> ExamAttempt:
    attempt = db.scalar(select(ExamAttempt).where(ExamAttempt.id == attempt_id).with_for_update())
    if not attempt or attempt.student_id != user.id:
        raise _not_found()
    if _finalize_if_expired(db, attempt):
        raise _error('ATTEMPT_EXPIRED', 'The attempt expired and was auto-submitted', 409)
    if attempt.status != AttemptStatus.in_progress:
        raise _error('ATTEMPT_NOT_IN_PROGRESS', 'This attempt is no longer in progress', 409)
    return attempt


@router.put('/{attempt_id}/answers')
@router.post('/{attempt_id}/answers', include_in_schema=False)
def save_answer(attempt_id: UUID, payload: AnswerSave, db: Session = Depends(get_db), user: User = Depends(current_user)):
    attempt = _writable_attempt(attempt_id, db, user)
    if not db.scalar(select(ExamQuestion.id).where(ExamQuestion.exam_id == attempt.exam_id, ExamQuestion.question_id == payload.question_id)):
        raise _error('INVALID_QUESTION', 'Question does not belong to this exam', 422)
    question = db.get(Question, payload.question_id)
    if not question or question.type not in SUPPORTED_QUESTION_TYPES:
        raise unsupported_question_type()
    answer = db.scalar(select(Answer).where(Answer.attempt_id == attempt.id, Answer.question_id == payload.question_id))
    saved_at = datetime.now(timezone.utc)
    content = payload.content()
    if not answer:
        answer = Answer(attempt_id=attempt.id, question_id=payload.question_id, answer_content=content, answered_at=saved_at)
        db.add(answer)
    else:
        answer.answer_content = content
        answer.answered_at = saved_at
    db.commit()
    db.refresh(answer)
    return ok({'id': answer.id, 'attempt_id': answer.attempt_id, 'question_id': answer.question_id, 'answer_content': answer.answer_content, 'saved_at': saved_at})


@router.post('/{attempt_id}/submit')
def submit(attempt_id: UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    attempt = db.scalar(select(ExamAttempt).where(ExamAttempt.id == attempt_id).with_for_update())
    if not attempt or attempt.student_id != user.id:
        raise _not_found()
    if _finalize_if_expired(db, attempt):
        return ok(_serialize_attempt(db, attempt, user))
    if attempt.status != AttemptStatus.in_progress:
        return ok(_serialize_attempt(db, attempt, user))
    grade_attempt(db, attempt)
    attempt.status = AttemptStatus.submitted
    attempt.submitted_at = datetime.now(timezone.utc)
    record_audit(db, action='attempt_submitted', user_id=user.id, entity_type='attempt', entity_id=attempt.id, metadata={'exam_id': str(attempt.exam_id), 'score': str(attempt.score)})
    db.commit()
    db.refresh(attempt)
    logger.info('attempt_submitted', extra={'attempt_id': str(attempt.id), 'exam_id': str(attempt.exam_id), 'student_id': str(user.id), 'score': str(attempt.score)})
    terminal_statuses = (AttemptStatus.submitted, AttemptStatus.auto_submitted, AttemptStatus.terminated)
    exam_attempts = db.scalars(select(ExamAttempt).where(ExamAttempt.exam_id == attempt.exam_id)).all()
    if exam_attempts and all(item.status in terminal_statuses for item in exam_attempts):
        students = {student.id: student.full_name for student in db.scalars(select(User).where(User.id.in_({item.student_id for item in exam_attempts}))).all()}
        risky = sorted(exam_attempts, key=lambda item: float(item.risk_score or 0), reverse=True)[:3]
        top_students = ', '.join(f"{students.get(item.student_id, 'Không rõ')} ({float(item.risk_score or 0):.2f})" for item in risky) or 'Không có dữ liệu'
        summary = (
            f'Tổng số sinh viên: {len({item.student_id for item in exam_attempts})}; '
            f'số bài có vi phạm: {sum(1 for item in exam_attempts if item.violation_count > 0)}; '
            f'top 3 risk_score: {top_students}.'
        )
        notify_teachers_of_exam(db, attempt.exam_id, 'exam_summary', 'Đề thi đã kết thúc', summary)
        db.commit()
    return ok(_serialize_attempt(db, attempt, user))


@router.get('/{attempt_id}/result')
def result(attempt_id: UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Return the student's submitted result without exposing answers during an active attempt."""
    stored = db.get(ExamAttempt, attempt_id)
    if stored and user.role == UserRole.teacher and not _can_view(db, stored, user):
        raise _error('FORBIDDEN', 'You do not own this exam', 403)
    attempt = _assert_viewable(stored, user, db)
    if attempt.status not in (AttemptStatus.submitted, AttemptStatus.auto_submitted, AttemptStatus.terminated):
        raise _error('ATTEMPT_NOT_SUBMITTED', 'This attempt has not been submitted', 409)
    exam = db.get(Exam, attempt.exam_id)
    settings = exam.extra_settings_json if exam and isinstance(exam.extra_settings_json, dict) else {}
    # TODO: formalize show_answers in the exam schema; until then only an explicit
    # setting or a closed exam can reveal the answer key.
    show_answers = bool(settings.get('show_answers')) if 'show_answers' in settings else bool(exam and exam.status.value == 'closed')
    if user.role in (UserRole.teacher, UserRole.admin):
        show_answers = True
    answers = {answer.question_id: answer for answer in db.scalars(select(Answer).where(Answer.attempt_id == attempt.id)).all()}
    rows = []
    for link, question in _ordered_links(db, attempt):
        answer = answers.get(question.id)
        rows.append({
            'answer_id':answer.id if answer else None,
            'question_id': question.id, 'order_index': link.order_index, 'type': question.type,
            'content': question.content, 'options_json': question.options_json,
            'images': QuestionForTeacher.model_validate(question).model_dump(mode='json')['images'] if user.role in (UserRole.teacher, UserRole.admin) else None,
            'student_answer': answer.answer_content if answer else None,
            'is_correct': answer.is_correct if answer else None,
            'points_awarded': answer.points_awarded if answer else None,
            'points': link.points, 'explanation': question.explanation,
            'correct_answer': question.correct_answer_json if show_answers else None,
        })
    student = db.get(User, attempt.student_id)
    return ok({
        'student': {'id':student.id, 'full_name':student.full_name, 'student_code':student.student_code} if student else None,
        'attempt_number':attempt.attempt_number,
        'id': attempt.id, 'exam_id': attempt.exam_id, 'exam_title': exam.title if exam else 'Bài thi', 'status': attempt.status,
        'submitted_at': attempt.submitted_at, 'started_at': attempt.started_at,
        'score': attempt.score, 'max_score': attempt.max_score,
        'show_answers': show_answers, 'questions': rows,
        **(student_result_metadata(db, attempt) if user.role == UserRole.student else {}),
    })
