from uuid import UUID
from datetime import datetime, timezone
from random import SystemRandom

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import roles
from app.api.responses import ok
from app.core.database import get_db
from app.models.entities import Question, QuestionBank, QuestionType, QuestionDifficulty, User, UserRole
from app.schemas.content import QuestionBankCreate, QuestionBankUpdate, QuestionCreate, QuestionForTeacher, QuestionUpdate
from app.schemas.question_selection import RandomSelectionRequest

from app.schemas.collections import CollectionParams
from app.services.collections import search, ordered, page_query
from app.services.question_types import SupportedQuestionType, SUPPORTED_QUESTION_TYPES, unsupported_question_type

router = APIRouter()

def _not_found(message: str) -> HTTPException:
    return HTTPException(404, detail={'code': 'NOT_FOUND', 'message': message, 'details': None})

def _can_manage(owner_id: UUID, user: User) -> bool:
    return user.role == UserRole.admin or owner_id == user.id

@router.get('')
def list_banks(params: CollectionParams=Depends(), db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    query = search(select(QuestionBank).where(QuestionBank.is_active.is_(True)),params.q,QuestionBank.name,QuestionBank.description,QuestionBank.subject)
    if user.role != UserRole.admin:
        query = query.where(QuestionBank.created_by == user.id)
    query=ordered(query,params.sort,{'newest':QuestionBank.created_at.desc(),'oldest':QuestionBank.created_at.asc(),'name':func.lower(QuestionBank.name).asc()},QuestionBank.id)
    query,total=page_query(db,query,params.page,params.limit)
    banks = db.scalars(query).all()
    counts = dict(db.execute(select(Question.question_bank_id, func.count()).where(
        Question.question_bank_id.in_([bank.id for bank in banks]), Question.type.in_(SUPPORTED_QUESTION_TYPES)
    ).group_by(Question.question_bank_id)).all()) if banks else {}
    return ok([{
        'id': bank.id, 'name': bank.name, 'description': bank.description, 'subject': bank.subject,
        'created_by': bank.created_by,
        'created_at': bank.created_at, 'updated_at': bank.updated_at,
        'questions_count': counts.get(bank.id, 0),
    } for bank in banks],total=total,page=params.page,limit=params.limit)

@router.post('')
def create_bank(payload: QuestionBankCreate, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    bank = QuestionBank(**payload.model_dump(), created_by=user.id)
    db.add(bank); db.commit(); db.refresh(bank)
    return ok(bank)

@router.get('/{bank_id}')
def get_bank(bank_id: UUID, include_questions: bool=True, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    bank = db.get(QuestionBank, bank_id)
    if not bank or not bank.is_active or not _can_manage(bank.created_by, user):
        raise _not_found('Question bank not found')
    questions = db.scalars(select(Question).where(Question.question_bank_id == bank.id, Question.type.in_(SUPPORTED_QUESTION_TYPES)).order_by(Question.created_at)).all() if include_questions else []
    question_count=db.scalar(select(func.count()).select_from(Question).where(Question.question_bank_id == bank.id, Question.type.in_(SUPPORTED_QUESTION_TYPES))) or 0
    return ok({'id': bank.id, 'name': bank.name, 'description': bank.description, 'subject': bank.subject, 'created_by': bank.created_by,
               'created_at': bank.created_at, 'updated_at': bank.updated_at, 'questions_count': question_count,
               'questions': [QuestionForTeacher.model_validate(q).model_dump(mode='json') for q in questions]})

@router.patch('/{bank_id}')
def update_bank(bank_id: UUID, payload: QuestionBankUpdate, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    bank = db.get(QuestionBank, bank_id)
    if not bank or not _can_manage(bank.created_by, user):
        raise _not_found('Question bank not found')
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(bank, key, value)
    bank.updated_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(bank)
    return ok(bank)

@router.delete('/{bank_id}')
def delete_bank(bank_id: UUID, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    bank = db.get(QuestionBank, bank_id)
    if not bank or not _can_manage(bank.created_by, user):
        raise _not_found('Question bank not found')
    bank.is_active = False
    db.commit()
    return ok({'deleted': True})

@router.get('/{bank_id}/questions')
def list_questions(
    bank_id: UUID, type: SupportedQuestionType | None = Query(default=None), topic: str | None = None, difficulty: QuestionDifficulty | None = None,
    params: CollectionParams=Depends(), is_active: bool|None=None,
    db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher)),
):
    bank = db.get(QuestionBank, bank_id)
    if not bank or not _can_manage(bank.created_by, user):
        raise _not_found('Question bank not found')
    query = search(select(Question).where(Question.question_bank_id == bank_id, Question.type.in_(SUPPORTED_QUESTION_TYPES)),params.q,Question.content)
    if is_active is not None: query=query.where(Question.is_active == is_active)
    if type is not None: query = query.where(Question.type == type)
    if topic is not None: query = query.where(Question.topic == topic)
    if difficulty is not None: query = query.where(Question.difficulty == difficulty)
    query=ordered(query,params.sort,{'newest':Question.created_at.desc(),'oldest':Question.created_at.asc()},Question.id)
    query,total=page_query(db,query,params.page,params.limit)
    topics=db.scalars(select(Question.topic).where(Question.question_bank_id == bank_id,Question.type.in_(SUPPORTED_QUESTION_TYPES),Question.topic.is_not(None)).distinct().order_by(Question.topic)).all()
    result=ok([QuestionForTeacher.model_validate(q).model_dump(mode='json') for q in db.scalars(query).all()],total=total,page=params.page,limit=params.limit)
    result['meta']['topics']=topics
    result['meta']['has_difficulty']=db.scalar(select(Question.id).where(Question.question_bank_id==bank_id,Question.type.in_(SUPPORTED_QUESTION_TYPES),Question.difficulty.is_not(None)).limit(1)) is not None
    return result

@router.post('/{bank_id}/questions')
def create_question(bank_id: UUID, payload: QuestionCreate, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    bank = db.get(QuestionBank, bank_id)
    if not bank or not _can_manage(bank.created_by, user):
        raise _not_found('Question bank not found')
    if payload.question_bank_id != bank_id:
        raise HTTPException(422, detail={'code': 'BANK_MISMATCH', 'message': 'question_bank_id does not match the URL', 'details': None})
    question = Question(**payload.model_dump())
    bank.updated_at = datetime.now(timezone.utc)
    db.add(question); db.commit(); db.refresh(question)
    return ok(QuestionForTeacher.model_validate(question).model_dump(mode='json'))


@router.post('/{bank_id}/random-select')
def preview_random_selection(bank_id: UUID, payload: RandomSelectionRequest, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    """Return a selection for review without creating an exam or any links."""
    bank = db.get(QuestionBank, bank_id)
    if not bank or not bank.is_active or not _can_manage(bank.created_by, user):
        raise _not_found('Question bank not found')
    query = select(Question).where(Question.question_bank_id == bank_id, Question.is_active.is_(True), Question.type.in_(SUPPORTED_QUESTION_TYPES))
    if payload.question_type is not None: query = query.where(Question.type == payload.question_type)
    if payload.topic is not None: query = query.where(Question.topic == payload.topic)
    if payload.difficulty is not None: query = query.where(Question.difficulty == payload.difficulty)
    if payload.exclude_ids: query = query.where(Question.id.not_in(payload.exclude_ids))
    candidates = db.scalars(query).all()
    group_field = 'difficulty' if payload.difficulty_counts is not None else 'topic'
    distribution = payload.difficulty_counts if payload.difficulty_counts is not None else payload.topic_counts
    pools = [(group, count, [q for q in candidates if getattr(q, group_field) == group]) for group, count in distribution.items()] if distribution is not None else [('all', payload.count, candidates)]
    shortages = [{'group': group, 'requested': count, 'available': len(pool)} for group, count, pool in pools if len(pool) < count]
    if shortages:
        labels = {'easy': 'câu dễ', 'medium': 'câu trung bình', 'hard': 'câu khó', 'all': 'câu phù hợp'}
        messages = [f"Ngân hàng chỉ có {row['available']} {labels.get(row['group'], 'câu thuộc chủ đề ' + row['group'])} nhưng bạn yêu cầu {row['requested']} câu." for row in shortages]
        raise HTTPException(400, detail={'code': 'NOT_ENOUGH_QUESTIONS', 'message': ' '.join(messages), 'details': shortages})
    rng = SystemRandom()
    selected = [question for _, count, pool in pools for question in rng.sample(pool, count)]
    rng.shuffle(selected)
    return ok([QuestionForTeacher.model_validate(q).model_dump(mode='json') for q in selected])

@router.get('/questions/{question_id}')
def get_question(question_id: UUID, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    question = db.get(Question, question_id)
    bank = db.get(QuestionBank, question.question_bank_id) if question else None
    if not question or not bank or not _can_manage(bank.created_by, user):
        raise _not_found('Question not found')
    return ok(QuestionForTeacher.model_validate(question).model_dump(mode='json'))

@router.patch('/questions/{question_id}')
def update_question(question_id: UUID, payload: QuestionUpdate, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    question = db.get(Question, question_id)
    bank = db.get(QuestionBank, question.question_bank_id) if question else None
    if not question or not bank or not _can_manage(bank.created_by, user):
        raise _not_found('Question not found')
    values = payload.model_dump(exclude_unset=True)
    if values.get('type', question.type) not in SUPPORTED_QUESTION_TYPES:
        raise unsupported_question_type()
    if 'question_bank_id' in values:
        target_bank = db.get(QuestionBank, values['question_bank_id'])
        if not target_bank or not _can_manage(target_bank.created_by, user):
            raise HTTPException(403, detail={'code': 'FORBIDDEN', 'message': 'Cannot move question to this bank', 'details': None})
    for key, value in values.items(): setattr(question, key, value)
    bank.updated_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(question)
    return ok(QuestionForTeacher.model_validate(question).model_dump(mode='json'))

@router.delete('/questions/{question_id}')
def delete_question(question_id: UUID, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    question = db.get(Question, question_id)
    bank = db.get(QuestionBank, question.question_bank_id) if question else None
    if not question or not bank or not _can_manage(bank.created_by, user):
        raise _not_found('Question not found')
    question.is_active = False
    bank.updated_at = datetime.now(timezone.utc)
    db.commit()
    return ok({'deleted': True})


from app.api.v1.question_documents import router as documents_router
router.include_router(documents_router)
