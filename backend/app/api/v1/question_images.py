"""Protected image reads for bank owners and the student's actual exam attempt."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.core.database import get_db
from app.models.entities import AttemptStatus, Exam, ExamAttempt, ExamQuestion, Question, QuestionBank, User, UserRole
from app.services.question_images import attachment_path

router = APIRouter()


@router.get('/question-images/{question_id}/{image_id}')
def get_image(question_id: UUID, image_id: UUID, attempt_id: UUID | None = None,
              db: Session = Depends(get_db), user: User = Depends(current_user)):
    question = db.get(Question, question_id)
    allowed = False
    if question:
        if user.role == UserRole.admin:
            allowed = True
        elif user.role == UserRole.teacher:
            bank = db.get(QuestionBank, question.question_bank_id)
            allowed = bank is not None and bank.created_by == user.id
            if not allowed:
                allowed = db.scalar(select(ExamQuestion.id).join(Exam, Exam.id == ExamQuestion.exam_id).where(
                    ExamQuestion.question_id == question_id, Exam.created_by == user.id).limit(1)) is not None
        elif user.role == UserRole.student and attempt_id:
            attempt = db.get(ExamAttempt, attempt_id)
            allowed = (attempt is not None and attempt.student_id == user.id
                       and attempt.status != AttemptStatus.not_started
                       and db.scalar(select(ExamQuestion.id).where(ExamQuestion.exam_id == attempt.exam_id,
                           ExamQuestion.question_id == question_id)) is not None)
    image = next((item for item in (question.images_json or []) if item['id'] == str(image_id)), None) if question else None
    if not allowed or image is None:
        raise HTTPException(404, detail={'code': 'NOT_FOUND', 'message': 'Không tìm thấy hình ảnh câu hỏi.', 'details': None})
    try:
        content = attachment_path(question_id, image_id).read_bytes()
    except OSError:
        raise HTTPException(404, detail={'code': 'NOT_FOUND', 'message': 'Hình ảnh không còn khả dụng.', 'details': None}) from None
    return Response(content, media_type='image/png', headers={
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})
