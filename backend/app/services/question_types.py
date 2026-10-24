"""Supported authoring types; the DB enum keeps legacy values for stored history."""
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import ExamQuestion, Question, QuestionType

SupportedQuestionType = Literal[QuestionType.mcq_single, QuestionType.mcq_multi, QuestionType.essay]
SUPPORTED_QUESTION_TYPES = (QuestionType.mcq_single, QuestionType.mcq_multi, QuestionType.essay)


def unsupported_question_type() -> HTTPException:
    return HTTPException(422, detail={'code': 'ORAL_EXAMS_DISABLED',
        'message': 'Hình thức thi này đã ngừng hỗ trợ. Vui lòng dùng câu hỏi trắc nghiệm hoặc tự luận.', 'details': None})


def require_supported_exam(db: Session, exam_id: UUID) -> None:
    legacy = db.scalar(select(Question.id).join(ExamQuestion, ExamQuestion.question_id == Question.id).where(
        ExamQuestion.exam_id == exam_id, Question.type.not_in(SUPPORTED_QUESTION_TYPES)).limit(1))
    if legacy:
        raise unsupported_question_type()
