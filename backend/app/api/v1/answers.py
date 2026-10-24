from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import roles
from app.api.responses import ok
from app.core.database import get_db
from app.models.entities import Answer, AttemptStatus, Exam, ExamAttempt, ExamQuestion, Question, QuestionType, User, UserRole
from app.schemas.attempts import ManualGrade
from app.services.grading import grade_attempt
from app.services.attempts import finalize_expired_attempt
from app.services.audit import record_audit
import logging

router = APIRouter()
logger = logging.getLogger('app.audit')


def _error(code: str, message: str, status: int) -> HTTPException:
    return HTTPException(status, detail={'code': code, 'message': message, 'details': None})


@router.patch('/answers/{answer_id}/grade')
@router.put('/answers/{answer_id}/grade', include_in_schema=False)
def grade_answer(
    answer_id: UUID, payload: ManualGrade, db: Session = Depends(get_db),
    user: User = Depends(roles(UserRole.admin, UserRole.teacher)),
):
    answer = db.get(Answer, answer_id)
    if not answer:
        raise _error('NOT_FOUND', 'Answer not found', 404)
    attempt = db.get(ExamAttempt, answer.attempt_id)
    exam = db.get(Exam, attempt.exam_id) if attempt else None
    if not attempt or not exam or (user.role == UserRole.teacher and exam.created_by != user.id):
        raise _error('FORBIDDEN', 'You cannot grade this answer', 403)
    # Any request touching an attempt must materialize its server-side expiry
    # before reading or changing grading state.
    if finalize_expired_attempt(db, attempt):
        db.commit()
    link = db.scalar(select(ExamQuestion).where(
        ExamQuestion.exam_id == attempt.exam_id, ExamQuestion.question_id == answer.question_id,
    ))
    question = db.get(Question, answer.question_id)
    if not link or not question:
        raise _error('NOT_FOUND', 'Exam question not found', 404)
    if question.type != QuestionType.essay:
        raise _error('INVALID_GRADING_TYPE', 'Only essay answers can be graded manually', 422)
    if payload.points_awarded is not None and (payload.points_awarded < 0 or payload.points_awarded > link.points):
        raise _error('INVALID_SCORE', f'points_awarded must be between 0 and {link.points}', 422)
    answer.points_awarded = payload.points_awarded
    answer.is_correct = None
    answer.graded_by = user.id
    answer.graded_at = datetime.now(timezone.utc)
    grade_attempt(db, attempt)
    record_audit(db, action='answer_graded', user_id=user.id, entity_type='answer', entity_id=answer.id, metadata={'attempt_id': str(attempt.id), 'points_awarded': str(answer.points_awarded)})
    db.commit()
    db.refresh(answer)
    db.refresh(attempt)
    logger.info('answer_manually_graded', extra={'answer_id': str(answer.id), 'attempt_id': str(attempt.id), 'grader_id': str(user.id), 'points_awarded': str(answer.points_awarded)})
    return ok({
        'answer': {
            'id': answer.id, 'attempt_id': answer.attempt_id, 'question_id': answer.question_id,
            'answer_content': answer.answer_content, 'points_awarded': answer.points_awarded,
            'graded_by': answer.graded_by, 'graded_at': answer.graded_at,
        },
        'attempt': {'id': attempt.id, 'score': attempt.score, 'max_score': attempt.max_score, 'status': attempt.status},
    })
