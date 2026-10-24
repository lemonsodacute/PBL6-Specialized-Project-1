"""Student result metadata; never change stored scores or grading policy."""
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models.entities import Answer, AttemptStatus, ExamAttempt, ExamQuestion, Question, QuestionType


def student_result_metadata(db: Session, attempt: ExamAttempt) -> dict:
    completed = attempt.status in (AttemptStatus.submitted, AttemptStatus.auto_submitted, AttemptStatus.terminated)
    if not completed:
        return {'grading_pending': False, 'final_score': None}
    pending = db.scalar(select(Answer.id).join(Question, Question.id == Answer.question_id)
                        .join(ExamQuestion, ExamQuestion.question_id == Answer.question_id).where(
                            Answer.attempt_id == attempt.id, ExamQuestion.exam_id == attempt.exam_id,
                            Question.type.in_((QuestionType.essay, QuestionType.oral)),
                            Answer.answer_content.is_not(None), Answer.points_awarded.is_(None),
                            ExamQuestion.points > 0,
                        ).limit(1)) is not None
    return {
        'grading_pending': completed and (pending or attempt.score is None),
        'final_score': attempt.score if completed and not pending else None,
    }


def student_result_metadata_many(db: Session, attempts: list[ExamAttempt]) -> dict:
    """Same grading policy as the single-row helper, with one pending-answer query."""
    completed = [item for item in attempts if item.status in (AttemptStatus.submitted, AttemptStatus.auto_submitted, AttemptStatus.terminated)]
    pending = set(db.scalars(select(Answer.attempt_id).join(Question, Question.id == Answer.question_id)
        .join(ExamAttempt, ExamAttempt.id == Answer.attempt_id)
        .join(ExamQuestion, and_(ExamQuestion.question_id == Answer.question_id, ExamQuestion.exam_id == ExamAttempt.exam_id))
        .where(Answer.attempt_id.in_([item.id for item in completed]), Question.type.in_((QuestionType.essay, QuestionType.oral)),
               Answer.answer_content.is_not(None), Answer.points_awarded.is_(None), ExamQuestion.points > 0).distinct())) if completed else set()
    completed_ids = {item.id for item in completed}
    return {item.id: {'grading_pending': item.id in completed_ids and (item.id in pending or item.score is None),
                      'final_score': item.score if item.id in completed_ids and item.id not in pending else None} for item in attempts}
