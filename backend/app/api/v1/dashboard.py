from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.api.deps import roles
from app.api.responses import ok
from app.core.database import get_db
from app.models.entities import AttemptStatus, Class, Exam, ExamAttempt, ExamStatus, User, UserRole, ViolationLog

router = APIRouter()

@router.get('/dashboard/stats')
def dashboard_stats(db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    now = datetime.now(timezone.utc)
    exam_scope = select(Exam.id).where(Exam.deleted_at.is_(None))
    if user.role != UserRole.admin: exam_scope = exam_scope.where(Exam.created_by == user.id)
    ongoing = db.scalar(select(func.count()).select_from(Exam).where(Exam.id.in_(exam_scope), Exam.status == ExamStatus.ongoing)) or 0
    active = db.scalar(select(func.count()).select_from(ExamAttempt).where(ExamAttempt.exam_id.in_(exam_scope), ExamAttempt.status == AttemptStatus.in_progress)) or 0
    classes_query = select(func.count()).select_from(Class)
    if user.role != UserRole.admin: classes_query = classes_query.where(Class.homeroom_teacher_id == user.id)
    classes = db.scalar(classes_query) or 0
    recent = db.scalar(select(func.count()).select_from(ViolationLog).join(ExamAttempt, ViolationLog.attempt_id == ExamAttempt.id).where(ExamAttempt.exam_id.in_(exam_scope), ViolationLog.occurred_at >= now - timedelta(minutes=5))) or 0
    return ok({'ongoing_exams':ongoing,'active_attempts':active,'classes':classes,'recent_violations':recent,'as_of':now,'recent_window_minutes':5})
