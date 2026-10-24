from datetime import datetime
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, cast, String, case
from sqlalchemy.orm import Session, aliased
from app.services.collections import search, ordered, page_query
from app.api.deps import roles
from app.api.responses import ok
from app.core.database import get_db
from app.models.entities import AuditLog, User, UserRole, Exam, ExamAttempt, Answer, Notification, SupportConversation

router = APIRouter()


def audit_targets(db: Session, logs: list[AuditLog]) -> dict:
    """Resolve current display names in batches; never rewrite the historical audit payload."""
    targets = {}
    ids = {}
    for log in logs:
        if log.entity_id:
            ids.setdefault(log.entity_type, set()).add(log.entity_id)
    user_ids = ids.get('user', set()) | ids.get('student_card', set())
    if user_ids:
        for user in db.scalars(select(User).where(User.id.in_(user_ids))):
            display = {'name': user.full_name, 'email': user.email, 'role': user.role,
                       'student_code': user.student_code}
            targets[('user', user.id)] = display
            targets[('student_card', user.id)] = display
    if ids.get('exam'):
        for exam in db.scalars(select(Exam).where(Exam.id.in_(ids['exam']))):
            targets[('exam', exam.id)] = {'name': exam.title, 'deleted': exam.deleted_at is not None}
    if ids.get('attempt'):
        query = select(ExamAttempt, Exam.title, User.full_name, User.student_code).join(Exam, Exam.id == ExamAttempt.exam_id).join(User, User.id == ExamAttempt.student_id).where(ExamAttempt.id.in_(ids['attempt']))
        for attempt, title, name, code in db.execute(query):
            targets[('attempt', attempt.id)] = {'name': title, 'description': f'{name} · Lần {attempt.attempt_number}', 'student_code': code}
    if ids.get('answer'):
        query = select(Answer.id, Exam.title, User.full_name, User.student_code).join(ExamAttempt, ExamAttempt.id == Answer.attempt_id).join(Exam, Exam.id == ExamAttempt.exam_id).join(User, User.id == ExamAttempt.student_id).where(Answer.id.in_(ids['answer']))
        for answer_id, title, name, code in db.execute(query):
            targets[('answer', answer_id)] = {'name': title, 'description': name, 'student_code': code}
    if ids.get('notification'):
        for notice in db.scalars(select(Notification).where(Notification.id.in_(ids['notification']))):
            targets[('notification', notice.id)] = {'name': notice.title}
    if ids.get('conversation'):
        query = select(SupportConversation.id, User.full_name).join(User, User.id == SupportConversation.owner_id).where(SupportConversation.id.in_(ids['conversation']))
        for conversation_id, name in db.execute(query):
            targets[('conversation', conversation_id)] = {'name': name}
    return targets

@router.get('/audit-logs')
def list_audit_logs(
    page: int = Query(1, ge=1), limit: int = Query(50, ge=1, le=100),
    action: str | None = Query(None, max_length=100), user_id: UUID | None = None,
    q: str=Query('',max_length=255), role: UserRole|None=None, sort: str='newest',
    from_time: datetime | None = None, to_time: datetime | None = None,
    db: Session = Depends(get_db), _: User = Depends(roles(UserRole.admin)),
):
    query = select(AuditLog, User).outerjoin(User, User.id == AuditLog.user_id)
    related=aliased(User)
    related_id=func.coalesce(case((AuditLog.entity_type.in_(['user', 'student_card']),cast(AuditLog.entity_id,String))),AuditLog.metadata_json['student_id'].as_string())
    query=query.outerjoin(related,cast(related.id,String)==related_id)
    conditions = []
    if action: conditions.append(AuditLog.action == action)
    if user_id: conditions.append(AuditLog.user_id == user_id)
    if from_time: conditions.append(AuditLog.created_at >= from_time)
    if to_time: conditions.append(AuditLog.created_at <= to_time)
    if role: conditions.append(User.role == role)
    if conditions:
        query = query.where(*conditions)
    query=search(query,q,User.full_name,User.email,AuditLog.action,AuditLog.entity_type,related.full_name,related.email,related.student_code)
    query=ordered(query,sort,{'newest':AuditLog.created_at.desc(),'oldest':AuditLog.created_at.asc()},AuditLog.id)
    query,total=page_query(db,query,page,limit)
    rows = db.execute(query).all()
    targets = audit_targets(db, [log for log, user in rows])
    data = [{'id': log.id, 'user_id': log.user_id, 'action': log.action, 'entity_type': log.entity_type, 'entity_id': log.entity_id, 'metadata': log.metadata_json, 'ip_address': log.ip_address, 'created_at': log.created_at, 'target': targets.get((log.entity_type, log.entity_id)), 'user': None if not user else {'id': user.id, 'full_name': user.full_name, 'email': user.email, 'role': user.role}} for log, user in rows]
    return ok(data, total=total, page=page, limit=limit)
