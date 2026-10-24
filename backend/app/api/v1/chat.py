import asyncio
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.responses import ok
from app.core.config import settings
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.entities import (AttemptStatus, ExamAttempt, Notification, NotificationType,
                                SupportConversation, SupportMessage, SupportSession, User, UserRole)
from app.services import support_realtime as realtime

router = APIRouter(prefix='/chat')


class SendMessage(BaseModel):
    model_config = ConfigDict(extra='forbid')
    body: str = Field(max_length=4000)
    client_id: UUID

    @field_validator('body')
    @classmethod
    def clean_body(cls, value):
        value = value.strip()
        if not value or '\x00' in value:
            raise ValueError('Message must contain text without null characters')
        return value


class ReadMessages(BaseModel):
    model_config = ConfigDict(extra='forbid')
    through_message_id: UUID


def accessible(db, user, conversation_id, *, lock=False):
    query = select(SupportConversation).where(SupportConversation.id == conversation_id)
    if user.role != UserRole.admin:
        query = query.where(SupportConversation.owner_id == user.id)
    if lock:
        query = query.with_for_update()
    row = db.scalar(query)
    if not row:
        raise HTTPException(404, 'Conversation not found')
    owner = db.get(User, row.owner_id)
    if not owner or owner.role not in (UserRole.student, UserRole.teacher):
        raise HTTPException(403, 'This account is no longer eligible for support chat')
    return row


def incoming(user, conversation):
    return and_(SupportMessage.kind != 'system', SupportMessage.sender_id == conversation.owner_id if user.role == UserRole.admin
            else SupportMessage.sender_id != conversation.owner_id)


def message_json(row):
    return {key: getattr(row, key) for key in ('id', 'conversation_id', 'sender_id', 'client_id', 'body', 'created_at', 'read_at', 'kind')}


def latest_case(db, conversation_id):
    return db.scalar(select(SupportSession).where(SupportSession.conversation_id == conversation_id)
                     .order_by(SupportSession.created_at.desc(), SupportSession.id.desc()).limit(1))


def case_json(row):
    return {'id': row.id, 'status': row.status, 'category': row.category, 'summary': row.summary,
            'closed_at': row.closed_at, 'closed_by': row.closed_by} if row else None


def active_case_filter():
    return select(SupportSession.id).where(SupportSession.conversation_id == SupportConversation.id,
        SupportSession.status.in_(['ESCALATED', 'ADMIN_ACTIVE'])).exists()


def conversation_json(db, row, user):
    owner = db.get(User, row.owner_id)
    latest = db.scalar(select(SupportMessage).where(SupportMessage.conversation_id == row.id)
                       .order_by(SupportMessage.created_at.desc(), SupportMessage.id.desc()).limit(1))
    unread = db.scalar(select(func.count()).select_from(SupportMessage).where(
        SupportMessage.conversation_id == row.id, SupportMessage.read_at.is_(None), incoming(user, row))) or 0
    return {'id': row.id, 'owner': {'id': owner.id, 'full_name': owner.full_name, 'email': owner.email,
            'role': owner.role, 'student_code': owner.student_code}, 'created_at': row.created_at,
            'last_message_at': row.last_message_at, 'last_message': message_json(latest) if latest else None,
            'unread_count': unread, 'support_case': case_json(latest_case(db, row.id))}


def event_for(db, conversation, kind):
    admins = db.scalars(select(User.id).where(User.role == UserRole.admin, User.is_active.is_(True))).all()
    return {'type': kind, 'conversation_id': str(conversation.id),
            'recipients': [str(value) for value in {conversation.owner_id, *admins}]}


@router.post('/support')
def ensure_support(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in (UserRole.student, UserRole.teacher):
        raise HTTPException(403, 'Only students and teachers can open support requests')
    row = db.scalar(select(SupportConversation).where(SupportConversation.owner_id == user.id, active_case_filter()))
    if not row:
        raise HTTPException(409, detail={'code': 'SUPPORT_ASSISTANT_REQUIRED', 'message': 'Hãy bắt đầu với AI PROCTO Support trước khi chuyển quản trị viên.'})
    return ok(conversation_json(db, row, user))


@router.get('/unread-count')
def unread_count(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    query = select(func.count()).select_from(SupportMessage).join(SupportConversation).join(
        User, User.id == SupportConversation.owner_id).where(
        SupportMessage.read_at.is_(None), SupportMessage.kind != 'system', User.role.in_([UserRole.student, UserRole.teacher]))
    if user.role == UserRole.admin:
        query = query.where(SupportMessage.sender_id == SupportConversation.owner_id)
    else:
        query = query.where(SupportConversation.owner_id == user.id, SupportMessage.sender_id != user.id)
    return ok({'count': db.scalar(query) or 0})


@router.get('/conversations')
def conversations(q: str = Query('', max_length=200), filter: Literal['all', 'unread', 'student', 'teacher', 'closed'] = 'all',
                  cursor: UUID | None = None, limit: int = Query(30, ge=1, le=100),
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    query = select(SupportConversation).join(User, User.id == SupportConversation.owner_id).where(
        User.role.in_([UserRole.student, UserRole.teacher]))
    if user.role != UserRole.admin:
        query = query.where(SupportConversation.owner_id == user.id)
    else:
        closed = select(SupportSession.id).where(SupportSession.conversation_id == SupportConversation.id, SupportSession.status == 'CLOSED').exists()
        query = query.where(SupportConversation.last_message_at.is_not(None), closed if filter == 'closed' else active_case_filter())
    if q.strip():
        term = '%' + q.strip().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        query = query.where(or_(*(column.ilike(term, escape='\\') for column in
                                 (User.full_name, User.email, User.student_code))))
    if filter in ('student', 'teacher'):
        query = query.where(User.role == UserRole(filter))
    if filter == 'unread':
        side = (SupportMessage.sender_id == SupportConversation.owner_id if user.role == UserRole.admin
                else SupportMessage.sender_id != SupportConversation.owner_id)
        query = query.where(select(SupportMessage.id).where(SupportMessage.conversation_id == SupportConversation.id,
                              SupportMessage.read_at.is_(None), SupportMessage.kind != 'system', side).exists())
    if cursor:
        anchor = accessible(db, user, cursor)
        if anchor.last_message_at is None:
            raise HTTPException(400, 'Invalid conversation cursor')
        query = query.where(or_(SupportConversation.last_message_at < anchor.last_message_at,
            and_(SupportConversation.last_message_at == anchor.last_message_at, SupportConversation.id < anchor.id)))
    rows = db.scalars(query.order_by(SupportConversation.last_message_at.desc(), SupportConversation.id.desc()).limit(limit + 1)).all()
    return {'data': [conversation_json(db, row, user) for row in rows[:limit]],
            'meta': {'next_cursor': str(rows[limit - 1].id) if len(rows) > limit else None}}


@router.get('/conversations/{conversation_id}')
def conversation(conversation_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(conversation_json(db, accessible(db, user, conversation_id), user))


@router.get('/conversations/{conversation_id}/messages')
def messages(conversation_id: UUID, before: UUID | None = None, limit: int = Query(40, ge=1, le=100),
             db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    accessible(db, user, conversation_id)
    query = select(SupportMessage).where(SupportMessage.conversation_id == conversation_id)
    if before:
        anchor = db.get(SupportMessage, before)
        if not anchor or anchor.conversation_id != conversation_id:
            raise HTTPException(400, 'Invalid message cursor')
        query = query.where(or_(SupportMessage.created_at < anchor.created_at,
            and_(SupportMessage.created_at == anchor.created_at, SupportMessage.id < anchor.id)))
    rows = db.scalars(query.order_by(SupportMessage.created_at.desc(), SupportMessage.id.desc()).limit(limit + 1)).all()
    return {'data': [message_json(row) for row in reversed(rows[:limit])],
            'meta': {'next_cursor': str(rows[limit - 1].id) if len(rows) > limit else None}}


@router.post('/conversations/{conversation_id}/messages')
def send(conversation_id: UUID, body: SendMessage, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = accessible(db, user, conversation_id, lock=True)
    existing = db.scalar(select(SupportMessage).where(SupportMessage.conversation_id == row.id,
        SupportMessage.sender_id == user.id, SupportMessage.client_id == body.client_id))
    if existing:
        if existing.body != body.body:
            raise HTTPException(409, 'Retry key already used for a different message')
        db.commit()
        return ok(message_json(existing))
    case = latest_case(db, row.id)
    if not case or case.status not in ('ESCALATED', 'ADMIN_ACTIVE'):
        raise HTTPException(409, detail={'code': 'SUPPORT_SESSION_CLOSED', 'message': 'Cuộc trò chuyện này đã kết thúc. Hãy bắt đầu cuộc trò chuyện mới.'})
    if user.role == UserRole.student and db.scalar(select(ExamAttempt.id).where(
            ExamAttempt.student_id == user.id, ExamAttempt.status == AttemptStatus.in_progress,
            ExamAttempt.server_deadline_at > datetime.now(timezone.utc)).limit(1)):
        raise HTTPException(403, detail={'code': 'EXAM_IN_PROGRESS', 'message': 'Không thể gửi tin nhắn hỗ trợ trong khi đang làm bài thi.'})
    if user.role == UserRole.admin:
        case.status = 'ADMIN_ACTIVE'
    message, event = append_message(db, row, user, body.body, body.client_id)
    db.commit()
    background_tasks.add_task(realtime.after_commit, db, event)
    return ok(message_json(message))


def append_message(db, row, user, body, client_id, kind='message'):
    """Persist a message and its notifications in the caller's transaction."""
    now = datetime.now(timezone.utc)
    # Serialize timestamps with the locked conversation, including same-tick
    # writes or a backwards clock adjustment, so read watermarks stay exact.
    if row.last_message_at:
        previous = row.last_message_at.replace(tzinfo=timezone.utc) if row.last_message_at.tzinfo is None else row.last_message_at
        now = max(now, previous + timedelta(microseconds=1))
    message = SupportMessage(id=uuid4(), conversation_id=row.id, sender_id=user.id,
                             client_id=client_id, body=body, kind=kind, created_at=now)
    db.add(message)
    row.updated_at = row.last_message_at = now
    event = event_for(db, row, 'message')
    recipients = ([row.owner_id] if user.role == UserRole.admin else
                  [UUID(value) for value in event['recipients'] if value != str(row.owner_id)])
    for recipient in recipients:
        db.add(Notification(id=uuid4(), recipient_user_id=recipient, type=NotificationType.support_message,
            title='Tin nhắn hỗ trợ mới', message=('Bạn có tin nhắn mới từ quản trị viên.' if user.role == UserRole.admin
                else f'{user.full_name} vừa gửi tin nhắn hỗ trợ.'), related_conversation_id=row.id, is_read=False, created_at=now))
    realtime.enqueue(db, event)
    return message, event


@router.post('/conversations/{conversation_id}/read')
def read(conversation_id: UUID, body: ReadMessages, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = accessible(db, user, conversation_id, lock=True)
    anchor = db.get(SupportMessage, body.through_message_id)
    if not anchor or anchor.conversation_id != row.id:
        raise HTTPException(400, 'Invalid read watermark')
    result = db.execute(update(SupportMessage).where(SupportMessage.conversation_id == row.id,
        SupportMessage.read_at.is_(None), incoming(user, row), or_(SupportMessage.created_at < anchor.created_at,
            and_(SupportMessage.created_at == anchor.created_at, SupportMessage.id <= anchor.id)))
        .values(read_at=datetime.now(timezone.utc)))
    if result.rowcount:
        notification_query = update(Notification).where(Notification.related_conversation_id == row.id,
            Notification.is_read.is_(False), Notification.created_at <= anchor.created_at)
        if user.role == UserRole.admin:
            notification_query = notification_query.where(Notification.recipient_user_id.in_(
                select(User.id).where(User.role == UserRole.admin)))
        else:
            notification_query = notification_query.where(Notification.recipient_user_id == user.id)
        db.execute(notification_query.values(is_read=True))
        event = event_for(db, row, 'read')
        realtime.enqueue(db, event)
        db.commit()
        background_tasks.add_task(realtime.after_commit, db, event)
    else:
        db.commit()  # Release the row lock even when everything was already read.
    return ok({'updated': result.rowcount})


@router.websocket('/ws')
async def socket(websocket: WebSocket, db: Session = Depends(get_db)):
    origin = websocket.headers.get('origin')
    if origin and origin not in settings.CORS_ORIGINS:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    user_id = None
    try:
        # Initial frame keeps the per-tab access token out of URLs and server logs.
        auth = await asyncio.wait_for(websocket.receive_json(), timeout=5)
        if not isinstance(auth, dict) or auth.get('type') != 'auth':
            raise ValueError('Authentication required')
        token = auth.get('token') if auth.get('token') is not None else websocket.cookies.get('auth_token')
        payload = decode_access_token(token)
        user_id = UUID(payload['sub'])
        def authorize():
            if payload['exp'] <= datetime.now(timezone.utc).timestamp():
                raise ValueError('Expired token')
            db.expire_all()
            actor = db.get(User, user_id)
            if not actor or not actor.is_active or actor.role not in (UserRole.admin, UserRole.student, UserRole.teacher):
                raise ValueError('Inactive user')
            db.rollback()  # Do not hold a transaction/connection while waiting for frames.
        await run_in_threadpool(authorize)
        await realtime.manager.connect(user_id, websocket)
        await websocket.send_json({'type': 'ready'})
        while True:
            try:
                frame = await asyncio.wait_for(websocket.receive_text(), timeout=25)
                if frame != 'pong' and frame != 'ping':
                    raise ValueError('Unsupported frame')
                if frame == 'pong':
                    await run_in_threadpool(authorize)
                    continue
            except asyncio.TimeoutError:
                pass
            await run_in_threadpool(authorize)
            await websocket.send_json({'type': 'ping'})
    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await websocket.close(code=1008)
        except RuntimeError:
            pass
    finally:
        if user_id:
            await realtime.manager.disconnect(user_id, websocket)
