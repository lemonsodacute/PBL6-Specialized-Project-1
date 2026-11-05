from datetime import datetime, timezone
from uuid import UUID
from app.schemas.collections import CollectionParams
from app.services.collections import search, ordered, page_query

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import current_user, roles
from app.api.responses import ok
from app.core.database import get_db
from app.models.entities import (
    Class, ClassEnrollment, Exam, ExamAssignment, ExamAttempt, ExamQuestion,
    ExamQuestionDrawRule, ExamStatus, AttemptStatus, Question, QuestionBank, User, UserRole,
)
from app.schemas.content import (
    ExamCreateContent, ExamQuestionCreate, ExamUpdateContent, RandomQuestionRequest,
    QuestionForStudent, QuestionForTeacher, student_safe_options,
    validate_exam_period,
)
from app.schemas.question_selection import ExamSelectionRequest
from app.services.settings import exam_defaults
from app.services.attempts import finalize_expired_attempt
from app.services.student_exam_state import student_result_metadata, student_result_metadata_many
from app.services.question_types import SUPPORTED_QUESTION_TYPES, require_supported_exam, unsupported_question_type

router = APIRouter()


def _not_found(message: str) -> HTTPException:
    return HTTPException(404, detail={'code': 'NOT_FOUND', 'message': message, 'details': None})


def _forbidden(message: str = 'You do not have access to this exam') -> HTTPException:
    return HTTPException(403, detail={'code': 'FORBIDDEN', 'message': message, 'details': None})


def _student_assigned(db: Session, exam_id: UUID, student_id: UUID) -> bool:
    return db.scalar(select(ExamAssignment.id).where(
        ExamAssignment.exam_id == exam_id,
        or_(
            ExamAssignment.student_id == student_id,
            ExamAssignment.class_id.in_(
                select(ClassEnrollment.class_id).where(ClassEnrollment.student_id == student_id)
            ),
        ),
    ).limit(1)) is not None


def _can_view(db: Session, exam: Exam, user: User) -> bool:
    if user.role == UserRole.admin:
        return True
    if user.role == UserRole.teacher:
        return exam.created_by == user.id
    return _student_assigned(db, exam.id, user.id)


def _exam_summary(db: Session, exam: Exam, user: User, summary=None) -> dict:
    question_count = summary['questions'].get(exam.id, 0) if summary is not None else db.scalar(select(func.count()).select_from(ExamQuestion).where(ExamQuestion.exam_id == exam.id)) or 0
    class_rows = summary['classes'].get(exam.id, []) if summary is not None else db.execute(
        select(Class.id, Class.name)
        .join(ExamAssignment, ExamAssignment.class_id == Class.id)
        .where(ExamAssignment.exam_id == exam.id)
    ).all()
    result = {
        'id': exam.id, 'title': exam.title, 'description': exam.description,
        'created_by': exam.created_by, 'start_time': exam.start_time, 'end_time': exam.end_time,
        'duration_minutes': exam.duration_minutes, 'status': exam.status,
        'shuffle_questions': exam.shuffle_questions, 'shuffle_options': exam.shuffle_options,
        'allow_review': exam.allow_review, 'max_attempts': exam.max_attempts,
        'passing_score': exam.passing_score, 'require_camera': exam.require_camera, 'require_mic': exam.require_mic,
        'require_fullscreen': exam.require_fullscreen,
        'violation_auto_lock_threshold': exam.violation_auto_lock_threshold,
        'questions_count': question_count,
        'classes': [{'id': row.id, 'name': row.name} for row in class_rows],
    }
    if user.role == UserRole.student:
        history = summary['history'].get(exam.id, []) if summary is not None else db.scalars(select(ExamAttempt).where(
            ExamAttempt.exam_id == exam.id, ExamAttempt.student_id == user.id
        ).order_by(ExamAttempt.attempt_number.desc())).all()
        changed=False
        for item in history if summary is None else []:
            if item.status == AttemptStatus.in_progress and item.server_deadline_at:
                deadline=item.server_deadline_at if item.server_deadline_at.tzinfo else item.server_deadline_at.replace(tzinfo=timezone.utc)
                if deadline < datetime.now(timezone.utc): changed=finalize_expired_attempt(db,item) or changed
        if changed: db.commit()
        attempt=history[0] if history else None
        result['attempt'] = None if not attempt else {
            'id': attempt.id, 'exam_id': attempt.exam_id, 'student_id': attempt.student_id,
            'status': attempt.status, 'attempt_number': attempt.attempt_number,
            'server_deadline_at': attempt.server_deadline_at,
            'started_at': attempt.started_at, 'submitted_at': attempt.submitted_at,
            'score': attempt.score, 'max_score': attempt.max_score,
            **(summary['metadata'][attempt.id] if summary is not None else student_result_metadata(db, attempt)),
        }
        result['attempts']=[{'id':item.id,'exam_id':item.exam_id,'student_id':item.student_id,'status':item.status,'attempt_number':item.attempt_number,
                            'score':item.score,'max_score':item.max_score,'server_deadline_at':item.server_deadline_at,
                            'started_at':item.started_at,'submitted_at':item.submitted_at,
                            **(summary['metadata'][item.id] if summary is not None else student_result_metadata(db, item))} for item in history]
    else:
        result['attempt_count'] = summary['attempts'].get(exam.id, (0, 0))[0] if summary is not None else db.scalar(select(func.count()).select_from(ExamAttempt).where(ExamAttempt.exam_id == exam.id)) or 0
        result['completed_attempt_count'] = summary['attempts'].get(exam.id, (0, 0))[1] if summary is not None else db.scalar(select(func.count()).select_from(ExamAttempt).where(ExamAttempt.exam_id == exam.id, ExamAttempt.status.in_((AttemptStatus.submitted, AttemptStatus.auto_submitted, AttemptStatus.terminated)))) or 0
    return result


def _list_summary(db: Session, exams: list[Exam], user: User) -> dict:
    ids = [exam.id for exam in exams]
    result = {'questions': {}, 'classes': {}, 'history': {}, 'metadata': {}, 'attempts': {}}
    if not ids:
        return result
    result['questions'] = dict(db.execute(select(ExamQuestion.exam_id, func.count()).where(ExamQuestion.exam_id.in_(ids)).group_by(ExamQuestion.exam_id)).all())
    for row in db.execute(select(ExamAssignment.exam_id, Class.id, Class.name).join(Class, Class.id == ExamAssignment.class_id).where(ExamAssignment.exam_id.in_(ids))):
        result['classes'].setdefault(row.exam_id, []).append(row)
    if user.role == UserRole.student:
        history = db.scalars(select(ExamAttempt).where(ExamAttempt.exam_id.in_(ids), ExamAttempt.student_id == user.id).order_by(ExamAttempt.attempt_number.desc())).all()
        for item in history:
            if item.status == AttemptStatus.in_progress and item.server_deadline_at:
                deadline = item.server_deadline_at if item.server_deadline_at.tzinfo else item.server_deadline_at.replace(tzinfo=timezone.utc)
                if deadline < datetime.now(timezone.utc) and finalize_expired_attempt(db, item):
                    db.commit()
            result['history'].setdefault(item.exam_id, []).append(item)
        result['metadata'] = student_result_metadata_many(db, history)
    else:
        completed = ExamAttempt.status.in_((AttemptStatus.submitted, AttemptStatus.auto_submitted, AttemptStatus.terminated))
        result['attempts'] = {row[0]: (row[1], row[2]) for row in db.execute(select(ExamAttempt.exam_id, func.count(), func.sum(case((completed, 1), else_=0))).where(ExamAttempt.exam_id.in_(ids)).group_by(ExamAttempt.exam_id))}
    return result


@router.get('')
def list_exams(
    page: int = Query(1,ge=1), limit: int = Query(20,ge=1,le=100), status: ExamStatus | None = Query(default=None),
    q: str = Query('',max_length=255), class_id: UUID|None=None, teacher_id: UUID|None=None, exam_id:UUID|None=None,
    require_camera: bool|None=None, require_mic: bool|None=None, period: str|None=None, sort: str='newest',monitoring_only:bool=False,
    from_time:datetime|None=None,to_time:datetime|None=None, actionable_only:bool=False, include_completed:bool=False,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    limit = max(1, min(limit, 100))
    query = search(select(Exam).where(Exam.deleted_at.is_(None)),q,Exam.title,Exam.description)
    if exam_id:query=query.where(Exam.id==exam_id)
    # Calendar windows include exams that opened before the visible window.
    if from_time:query=query.where(Exam.end_time>=from_time)
    if to_time:query=query.where(Exam.start_time<to_time)
    if monitoring_only:query=query.where(Exam.status.in_((ExamStatus.published,ExamStatus.ongoing)),Exam.end_time>datetime.now(timezone.utc))
    if class_id: query=query.where(Exam.id.in_(select(ExamAssignment.exam_id).where(ExamAssignment.class_id == class_id)))
    if teacher_id: query=query.where(Exam.created_by == teacher_id)
    if require_camera is not None: query=query.where(Exam.require_camera == require_camera)
    if require_mic is not None: query=query.where(Exam.require_mic == require_mic)
    if period:
        now=datetime.now(timezone.utc)
        choices={'upcoming':(Exam.start_time > now) & (Exam.status != ExamStatus.closed),
                 'open':(Exam.start_time <= now) & (Exam.end_time > now) & (Exam.status != ExamStatus.closed),
                 'ended':(Exam.end_time <= now) | (Exam.status == ExamStatus.closed)}
        if period not in choices: raise HTTPException(422,detail={'code':'INVALID_PERIOD','message':'Unsupported period','details':None})
        query=query.where(choices[period])
    if status is not None:
        query = query.where(Exam.status == status)
    if user.role == UserRole.admin:
        pass
    elif user.role == UserRole.teacher:
        query = query.where(Exam.created_by == user.id)
    else:
        # Retain legacy exams for teacher/history review, but do not offer a
        # removed exam format to students as an exam they can take.
        legacy_exams = select(ExamQuestion.exam_id).join(Question, Question.id == ExamQuestion.question_id).where(Question.type.not_in(SUPPORTED_QUESTION_TYPES))
        query = query.where(Exam.id.not_in(legacy_exams))
        query = query.where(Exam.id.in_(
            select(ExamAssignment.exam_id).where(or_(
                ExamAssignment.student_id == user.id,
                ExamAssignment.class_id.in_(
                    select(ClassEnrollment.class_id).where(ClassEnrollment.student_id == user.id)
                ),
            ))
        ))
    if actionable_only:
        if user.role != UserRole.student:
            raise _forbidden('Only students can request actionable exams')
        now = datetime.now(timezone.utc)
        # Reconcile expiry before filtering/counting. An auto-submitted attempt
        # remains actionable only if the exam still has another allowed attempt.
        expired = db.scalars(select(ExamAttempt).where(
            ExamAttempt.student_id == user.id,
            ExamAttempt.exam_id.in_(query.with_only_columns(Exam.id)),
            ExamAttempt.status == AttemptStatus.in_progress,
            ExamAttempt.server_deadline_at < now,
        )).all()
        changed = False
        for attempt in expired:
            changed = finalize_expired_attempt(db, attempt) or changed
        if changed:
            db.commit()
        own = select(ExamAttempt.id).where(ExamAttempt.exam_id == Exam.id, ExamAttempt.student_id == user.id).correlate(Exam)
        working = own.where(ExamAttempt.status == AttemptStatus.in_progress).exists()
        completed = own.where(ExamAttempt.status.in_(
            (AttemptStatus.submitted, AttemptStatus.auto_submitted, AttemptStatus.terminated)
        )).exists()
        attempt_count = select(func.count()).select_from(ExamAttempt).where(
            ExamAttempt.exam_id == Exam.id, ExamAttempt.student_id == user.id,
        ).correlate(Exam).scalar_subquery()
        eligible = and_(
            Exam.status.in_((ExamStatus.published, ExamStatus.ongoing)),
            Exam.end_time > now,
            attempt_count < Exam.max_attempts,
        )
        # The student exam catalogue can show completed attempts even if the
        # configured limit or end date prevents a retake. The card will explain
        # the actual policy instead of displaying an empty catalogue.
        query = query.where(or_(working, eligible, completed) if include_completed else or_(working, eligible))
    query=ordered(query,sort,{'newest':Exam.created_at.desc(),'oldest':Exam.created_at.asc(),'name':func.lower(Exam.title).asc(),'start_time':Exam.start_time.asc()},Exam.id)
    # Return all actionable exams so history/page boundaries never hide work.
    # History remains paginated on /attempts/mine.
    query,total=page_query(db,query,None if actionable_only else page,limit)
    exams = db.scalars(query).all()
    summary = _list_summary(db, exams, user)
    return ok([_exam_summary(db, exam, user, summary) for exam in exams], total=total, page=None if actionable_only else page, limit=None if actionable_only else limit)


@router.get('/{exam_id}')
def get_exam(exam_id: UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    exam = db.get(Exam, exam_id)
    if not exam or exam.deleted_at is not None:
        raise _not_found('Exam not found')
    if not _can_view(db, exam, user):
        raise _forbidden()
    data = _exam_summary(db, exam, user)
    links = db.scalars(select(ExamQuestion).where(ExamQuestion.exam_id == exam.id).order_by(ExamQuestion.order_index)).all()
    questions = []
    for link in links:
        question = db.get(Question, link.question_id)
        if not question:
            continue
        serialized = (QuestionForStudent if user.role == UserRole.student else QuestionForTeacher).model_validate(question).model_dump(mode='json')
        if user.role == UserRole.student:
            serialized['options_json'] = student_safe_options(serialized.get('options_json'))
        serialized.update({'order_index': link.order_index, 'points': link.points})
        questions.append(serialized)
    data.update({
        'settings': {
            'shuffle_questions': exam.shuffle_questions, 'shuffle_options': exam.shuffle_options,
            'require_camera': exam.require_camera, 'require_mic': exam.require_mic, 'require_fullscreen': exam.require_fullscreen,
            'violation_auto_lock_threshold': exam.violation_auto_lock_threshold,
            'max_attempts': exam.max_attempts, 'allow_review': exam.allow_review,
        },
        'questions': questions,
    })
    return ok(data)


@router.post('')
def create_exam(payload: ExamCreateContent, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    values = payload.model_dump()
    defaults = exam_defaults(db, user)
    for source, target in (('exam_duration_minutes', 'duration_minutes'), ('exam_require_camera', 'require_camera'), ('exam_require_mic', 'require_mic')):
        if target not in payload.model_fields_set:
            values[target] = defaults[source]
    exam = Exam(**values, created_by=user.id)
    db.add(exam)
    db.commit()
    db.refresh(exam)
    return ok(_exam_summary(db, exam, user))


@router.patch('/{exam_id}')
def update_exam(exam_id: UUID, payload: ExamUpdateContent, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    exam = db.get(Exam, exam_id)
    if not exam or exam.deleted_at is not None:
        raise _not_found('Exam not found')
    if user.role != UserRole.admin and exam.created_by != user.id:
        raise _forbidden('Only the creator or an admin can edit this exam')
    values = payload.model_dump(exclude_unset=True)
    if db.scalar(select(ExamAttempt.id).where(ExamAttempt.exam_id == exam.id).limit(1)):
        # Existing submissions, grading and proctoring logs are immutable.
        # Only a *larger* retake allowance or a later deadline is safe to edit.
        def same_value(key: str, value: object) -> bool:
            current = getattr(exam, key)
            if isinstance(current, datetime) and isinstance(value, datetime):
                def utc(value: datetime) -> datetime:
                    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
                return utc(current) == utc(value)
            return current == value

        changed = {key: value for key, value in values.items() if not same_value(key, value)}
        if set(changed) - {'max_attempts', 'end_time'}:
            raise HTTPException(409, detail={'code': 'EXAM_HAS_ATTEMPTS', 'message': 'Chỉ có thể tăng số lượt làm và gia hạn sau khi đã có bài nộp.', 'details': None})
        if 'max_attempts' in changed and changed['max_attempts'] < exam.max_attempts:
            raise HTTPException(422, detail={'code': 'INVALID_RETAKE_LIMIT', 'message': 'Số lần làm tối đa không được giảm khi đã có lượt thi.', 'details': None})
        if 'end_time' in changed:
            proposed = changed['end_time']
            current_end = exam.end_time
            proposed = proposed.replace(tzinfo=timezone.utc) if proposed.tzinfo is None else proposed.astimezone(timezone.utc)
            current_end = current_end.replace(tzinfo=timezone.utc) if current_end.tzinfo is None else current_end.astimezone(timezone.utc)
            if proposed < current_end:
                raise HTTPException(422, detail={'code': 'INVALID_EXAM_END_TIME', 'message': 'Không thể rút ngắn hạn thi sau khi đã có lượt làm.', 'details': None})
        values = changed
    if payload.status in (ExamStatus.published, ExamStatus.ongoing):
        require_supported_exam(db, exam.id)
    try:
        validate_exam_period(values.get('start_time', exam.start_time), values.get('end_time', exam.end_time))
    except ValueError:
        raise HTTPException(422, detail={'code': 'INVALID_DATE_RANGE', 'message': 'Thời gian kết thúc phải sau thời gian bắt đầu.', 'details': None}) from None
    for key, value in values.items():
        setattr(exam, key, value)
    db.commit()
    db.refresh(exam)
    return ok(_exam_summary(db, exam, user))


@router.delete('/{exam_id}')
def delete_exam(exam_id: UUID, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    exam = db.get(Exam, exam_id)
    if not exam or exam.deleted_at is not None:
        raise _not_found('Exam not found')
    if user.role != UserRole.admin and exam.created_by != user.id:
        raise _forbidden('Only the creator or an admin can delete this exam')
    if db.scalar(select(ExamAttempt.id).where(ExamAttempt.exam_id == exam.id).limit(1)):
        raise HTTPException(409, detail={'code': 'EXAM_HAS_ATTEMPTS', 'message': 'Cannot delete an exam that already has attempts', 'details': None})
    exam.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return ok({'deleted': True})


@router.post('/{exam_id}/questions')
def add_exam_question(exam_id: UUID, payload: ExamQuestionCreate, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    exam = db.get(Exam, exam_id)
    if not exam or exam.deleted_at is not None:
        raise _not_found('Exam not found')
    if user.role != UserRole.admin and exam.created_by != user.id:
        raise _forbidden()
    question = db.get(Question, payload.question_id)
    if not question:
        raise _not_found('Question not found')
    bank = db.get(QuestionBank, question.question_bank_id)
    if user.role != UserRole.admin and (not bank or bank.created_by != user.id):
        raise _forbidden('You can only use your own question bank')
    if question.type not in SUPPORTED_QUESTION_TYPES:
        raise unsupported_question_type()
    if db.scalar(select(ExamQuestion.id).where(ExamQuestion.exam_id == exam_id, ExamQuestion.question_id == payload.question_id)):
        raise HTTPException(409, detail={'code': 'QUESTION_ALREADY_ASSIGNED', 'message': 'Question is already assigned to this exam', 'details': None})
    link = ExamQuestion(exam_id=exam_id, **payload.model_dump())
    db.add(link)
    db.commit()
    db.refresh(link)
    return ok({'id': link.id, 'exam_id': link.exam_id, 'question_id': link.question_id, 'order_index': link.order_index, 'points': link.points})


@router.put('/{exam_id}/questions')
def replace_exam_selection(exam_id: UUID, payload: ExamSelectionRequest, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    exam = db.scalar(select(Exam).where(Exam.id == exam_id).with_for_update())
    if not exam or exam.deleted_at is not None:
        raise _not_found('Exam not found')
    if user.role != UserRole.admin and exam.created_by != user.id:
        raise _forbidden()
    if exam.status != ExamStatus.draft or db.scalar(select(ExamAttempt.id).where(ExamAttempt.exam_id == exam.id).limit(1)):
        raise HTTPException(409, detail={'code': 'EXAM_NOT_EDITABLE', 'message': 'Chỉ có thể thay đổi câu hỏi của đề nháp chưa có bài làm.', 'details': None})
    selected = db.scalars(select(Question).where(Question.id.in_(payload.question_ids))).all() if payload.question_ids else []
    if len(selected) != len(payload.question_ids) or any(not q.is_active for q in selected):
        raise _not_found('Một hoặc nhiều câu hỏi không còn khả dụng.')
    bank_ids = {q.question_bank_id for q in selected}
    banks = db.scalars(select(QuestionBank).where(QuestionBank.id.in_(bank_ids))).all() if bank_ids else []
    if len(banks) != len(bank_ids) or any(not bank.is_active or (user.role != UserRole.admin and bank.created_by != user.id) for bank in banks):
        raise _forbidden('Bạn chỉ có thể dùng ngân hàng câu hỏi được phép quản lý.')
    if any(question.type not in SUPPORTED_QUESTION_TYPES for question in selected):
        raise unsupported_question_type()
    links = db.scalars(select(ExamQuestion).where(ExamQuestion.exam_id == exam_id)).all()
    existing = {link.question_id: link for link in links}
    desired = set(payload.question_ids)
    for link in links:
        if link.question_id not in desired: db.delete(link)
    for index, question_id in enumerate(payload.question_ids):
        if question_id in existing:
            existing[question_id].order_index = index
        else:
            # Keep the existing authoring convention: new links are worth one point.
            db.add(ExamQuestion(exam_id=exam_id, question_id=question_id, order_index=index, points=1))
    db.commit()
    return ok({'question_ids': payload.question_ids})


@router.post('/{exam_id}/questions/random')
def add_random_questions(exam_id: UUID, payload: RandomQuestionRequest, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    exam = db.get(Exam, exam_id)
    bank = db.get(QuestionBank, payload.question_bank_id)
    if not exam or exam.deleted_at is not None:
        raise _not_found('Exam not found')
    if not bank:
        raise _not_found('Question bank not found')
    if user.role != UserRole.admin and (exam.created_by != user.id or bank.created_by != user.id):
        raise _forbidden()
    query = select(Question).where(Question.question_bank_id == bank.id, Question.is_active.is_(True), Question.type.in_(SUPPORTED_QUESTION_TYPES))
    if payload.question_type is not None:
        query = query.where(Question.type == payload.question_type)
    if payload.topic is not None:
        query = query.where(Question.topic == payload.topic)
    if payload.difficulty is not None:
        query = query.where(Question.difficulty == payload.difficulty)
    existing = select(ExamQuestion.question_id).where(ExamQuestion.exam_id == exam.id)
    available = db.scalars(query.where(Question.id.not_in(existing)).order_by(func.random()).limit(payload.count)).all()
    if len(available) < payload.count:
        raise HTTPException(400, detail={'code': 'NOT_ENOUGH_QUESTIONS', 'message': f'Only {len(available)} matching questions are available', 'details': None})
    links = [ExamQuestion(exam_id=exam.id, question_id=q.id, order_index=payload.order_start + i, points=payload.points_each) for i, q in enumerate(available)]
    db.add_all(links)
    db.commit()
    return ok([{'question_id': link.question_id, 'order_index': link.order_index, 'points': link.points} for link in links])
