import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Answer, ExamAttempt, ExamQuestion, Question, QuestionType
import logging

logger = logging.getLogger('app.audit')


def _value(answer: Any, keys: tuple[str, ...]) -> Any:
    if isinstance(answer, dict):
        for key in keys:
            if key in answer:
                return answer[key]
    return answer


def _as_set(value: Any) -> set[str]:
    if value is None:
        return set()
    if not isinstance(value, list):
        value = [value]
    return {json.dumps(item, sort_keys=True) for item in value}


def _mcq_correct(question: Question, answer_content: Any) -> bool:
    correct = question.correct_answer_json
    if question.type == QuestionType.mcq_single:
        selected = _value(answer_content, ('selected_option_id', 'selected_option', 'answer'))
        expected = _value(correct, ('correct_option_id', 'correct_option', 'answer'))
        if isinstance(selected, list):
            return len(selected) == 1 and selected[0] == expected
        return selected == expected
    if question.type == QuestionType.mcq_multi:
        selected = _value(answer_content, ('selected_option_ids', 'selected_options', 'answers'))
        expected = _value(correct, ('correct_option_ids', 'correct_options', 'answers'))
        return _as_set(selected) == _as_set(expected)
    return False


def grade_attempt(db: Session, attempt: ExamAttempt) -> None:
    '''Grade an attempt using exam-question points.

    mcq_multi is all-or-nothing: the selected set must exactly match the
    correct set, so partial selections receive zero points. Essay and oral
    remain manually graded with points_awarded = null until then.
    '''
    links = db.scalars(select(ExamQuestion).where(ExamQuestion.exam_id == attempt.exam_id)).all()
    answers = {answer.question_id: answer for answer in db.scalars(select(Answer).where(Answer.attempt_id == attempt.id)).all()}
    score = Decimal('0')
    max_score = Decimal('0')
    for link in links:
        points = Decimal(link.points)
        max_score += points
        answer = answers.get(link.question_id)
        question = db.get(Question, link.question_id)
        if not answer or not question:
            continue
        if question.type in (QuestionType.essay, QuestionType.oral):
            if answer.points_awarded is not None:
                score += Decimal(answer.points_awarded)
            continue
        answer.is_correct = _mcq_correct(question, answer.answer_content)
        answer.points_awarded = points if answer.is_correct else Decimal('0')
        answer.graded_at = datetime.now(timezone.utc)
        score += answer.points_awarded
    attempt.score = score
    attempt.max_score = max_score
    logger.info('attempt_graded', extra={'attempt_id': str(attempt.id), 'score': str(score), 'max_score': str(max_score)})
