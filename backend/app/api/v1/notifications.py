from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.api.deps import roles
from app.api.responses import ok
from app.core.database import get_db
from app.models.entities import Notification, NotificationType, User, UserRole
from app.services.settings import notification_visibility

router = APIRouter()

def _serialize(row: Notification) -> dict:
    return {
        'id': row.id, 'recipient_user_id': row.recipient_user_id, 'type': row.type,
        'title': row.title, 'message': row.message, 'related_exam_id': row.related_exam_id,
        'related_attempt_id': row.related_attempt_id, 'severity': row.severity,
        'related_proctor_event_id': row.related_proctor_event_id,
        'proctor_event_simulated': row.proctor_event_simulated,
        'related_student_id': row.related_student_id,
        'related_conversation_id': row.related_conversation_id,
        'is_read': row.is_read, 'created_at': row.created_at, 'email_sent_at': row.email_sent_at,
    }

@router.get('/notifications')
def list_notifications(page: int = Query(1, ge=1), limit: int = Query(20, ge=1, le=100), is_read: bool | None = Query(None), type: NotificationType|None=None, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.teacher, UserRole.admin, UserRole.student))):
    query = select(Notification).where(Notification.recipient_user_id == user.id)
    visible = notification_visibility(db, user)
    if visible is not None: query = query.where(visible)
    if is_read is not None: query = query.where(Notification.is_read == is_read)
    if type is not None: query=query.where(Notification.type == type)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.scalars(query.order_by(Notification.created_at.desc(),Notification.id).offset((page - 1) * limit).limit(limit)).all()
    return ok([_serialize(row) for row in rows], total=total, page=page, limit=limit)

@router.patch('/notifications/{notification_id}/read')
def mark_read(notification_id: UUID, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.teacher, UserRole.admin, UserRole.student))):
    row = db.scalar(select(Notification).where(Notification.id == notification_id, Notification.recipient_user_id == user.id))
    if not row: raise HTTPException(404, detail={'code': 'NOT_FOUND', 'message': 'Notification not found', 'details': None})
    row.is_read = True; db.commit(); db.refresh(row)
    return ok(_serialize(row))

@router.patch('/notifications/read-all')
def mark_all_read(db: Session = Depends(get_db), user: User = Depends(roles(UserRole.teacher, UserRole.admin, UserRole.student))):
    result = db.execute(update(Notification).where(Notification.recipient_user_id == user.id, Notification.is_read.is_(False)).values(is_read=True))
    db.commit()
    return ok({'updated': result.rowcount})

@router.get('/notifications/unread-count')
def unread_count(db: Session = Depends(get_db), user: User = Depends(roles(UserRole.teacher, UserRole.admin, UserRole.student))):
    query = select(func.count()).select_from(Notification).where(Notification.recipient_user_id == user.id, Notification.is_read.is_(False))
    visible = notification_visibility(db, user)
    if visible is not None: query = query.where(visible)
    count = db.scalar(query) or 0
    return ok({'count': count})
