from datetime import datetime, timezone
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models.entities import Exam, ExamProctor, Notification, NotificationType, User, UserRole
from app.services.email import get_email_sender

def create_notification(db: Session, recipient_user_id: UUID, type: NotificationType | str, title: str, message: str, related_exam_id: UUID | None = None, related_attempt_id: UUID | None = None, severity: str | None = None, *, related_student_id: UUID | None = None, send_email: bool = True) -> Notification:
    notification = Notification(recipient_user_id=recipient_user_id, type=NotificationType(type), title=title, message=message, related_exam_id=related_exam_id, related_attempt_id=related_attempt_id, severity=severity, related_student_id=related_student_id)
    db.add(notification); db.flush()
    recipient = db.get(User, recipient_user_id)
    if send_email and recipient and recipient.email:
        get_email_sender().send(recipient.email, title, message)
        notification.email_sent_at = datetime.now(timezone.utc)
    return notification

def notify_teachers_of_exam(db: Session, exam_id: UUID, type: NotificationType | str, title: str, message: str, related_attempt_id: UUID | None = None, severity: str | None = None) -> list[Notification]:
    exam = db.get(Exam, exam_id)
    if not exam: return []
    teacher_ids = set(db.scalars(select(User.id).where(User.id == exam.created_by, User.role == UserRole.teacher)).all())
    teacher_ids.update(db.scalars(select(User.id).join(ExamProctor, ExamProctor.proctor_id == User.id).where(ExamProctor.exam_id == exam_id, User.role == UserRole.teacher)).all())
    return [create_notification(db, teacher_id, type, title, message, exam_id, related_attempt_id, severity) for teacher_id in teacher_ids]
