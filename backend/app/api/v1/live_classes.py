import asyncio
import logging
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import and_, select, text
from sqlalchemy import func, case
from app.schemas.collections import CollectionParams
from app.services.collections import search, ordered, page_query
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.api.deps import roles
from app.api.responses import ok
from app.core.database import get_db
from app.core.config import get_settings
from app.models.entities import Class, ClassAttendance, ClassEnrollment, LiveClass, LiveClassStatus, User, UserRole
from app.schemas.live_classes import ClassroomConnection, LiveClassCreate
from app.services.classroom_attendance import close_interval, connected, disconnected, utc
from app.services.classroom_provider import ClassroomProvider, get_classroom_provider, room_name

router = APIRouter()
member = roles(UserRole.admin, UserRole.teacher, UserRole.student)
manager = roles(UserRole.admin, UserRole.teacher)
logger = logging.getLogger('uvicorn.error')


def trace_room(step, item, **safe_fields):
    if get_settings().ENVIRONMENT.lower() not in ('prod', 'production'):
        # Call sites pass only codes, booleans and session metadata, never JWTs,
        # provider exceptions, credentials or request/response bodies.
        logger.info('classroom %s %s', step, {
            'session_id': str(item.id), 'session_status': item.status.value,
            'provider': 'livekit', 'room_name': room_name(item.id), **safe_fields,
        })


def fail(status, code, message):
    raise HTTPException(status, detail={'code': code, 'message': message})


def _get_live_class(db, session_id, *, lock=False):
    query = select(LiveClass).where(LiveClass.id == session_id, LiveClass.deleted_at.is_(None))
    item = _locked_scalar(db, query) if lock else db.scalar(query)
    if not item:
        fail(404, 'NOT_FOUND', 'Không tìm thấy buổi học.')
    return item


def _locked_scalar(db, query):
    # Bounded waits during provider outages, executed outside the event loop.
    if db.get_bind().dialect.name == 'postgresql':
        db.execute(text("SET LOCAL lock_timeout = '5s'"))
    try:
        return db.scalar(query.with_for_update())
    except OperationalError as exc:
        if getattr(exc.orig, 'pgcode', None) == '55P03':
            db.rollback()
            fail(503, 'CLASSROOM_BUSY', 'Phòng học đang xử lý kết nối khác. Vui lòng thử lại.')
        raise


def _managed(db, item, user):
    cls = db.get(Class, item.class_id)
    return user.role == UserRole.admin or (user.role == UserRole.teacher and item.teacher_id == user.id and cls and cls.homeroom_teacher_id == user.id)


def _authorized(db, item, user):
    return _managed(db, item, user) or (user.role == UserRole.student and bool(db.scalar(select(ClassEnrollment.id).where(ClassEnrollment.class_id == item.class_id, ClassEnrollment.student_id == user.id))))


def _access(db, item, user, *, manage=False, live=False):
    if not (_managed(db, item, user) if manage else _authorized(db, item, user)):
        fail(404, 'NOT_FOUND', 'Không tìm thấy buổi học hoặc bạn không có quyền truy cập.')
    if live and item.status != LiveClassStatus.ongoing:
        code = 'SESSION_ENDED' if item.status in (LiveClassStatus.ended, LiveClassStatus.cancelled) else 'ROOM_NOT_LIVE'
        fail(409, code, 'Buổi học chưa bắt đầu hoặc đã kết thúc.')


def _serialize(db, item):
    cls = db.get(Class, item.class_id)
    teacher = db.get(User, item.teacher_id)
    return {key: getattr(item, key) for key in ('id', 'class_id', 'teacher_id', 'title', 'description', 'scheduled_start', 'scheduled_end', 'actual_start', 'actual_end', 'meeting_url', 'recording_url', 'status', 'deleted_at', 'created_at', 'updated_at')} | {
        'class_name': cls.name if cls else None, 'teacher_name': teacher.full_name if teacher else None,
        'provider_close_pending': item.provider_close_pending,
    }


@router.get('')
def list_live_classes(params: CollectionParams=Depends(), status: LiveClassStatus|None=None, class_id: UUID|None=None,from_time:datetime|None=None,to_time:datetime|None=None, db: Session = Depends(get_db), user: User = Depends(member)):
    query = search(select(LiveClass).join(Class,Class.id == LiveClass.class_id).where(LiveClass.deleted_at.is_(None)),params.q,LiveClass.title,Class.name)
    if status is not None: query=query.where(LiveClass.status == status)
    if class_id is not None: query=query.where(LiveClass.class_id == class_id)
    if from_time:query=query.where(LiveClass.scheduled_end>=from_time)
    if to_time:query=query.where(LiveClass.scheduled_start<to_time)
    if user.role == UserRole.teacher:
        query = query.where(LiveClass.teacher_id == user.id, LiveClass.class_id.in_(select(Class.id).where(Class.homeroom_teacher_id == user.id)))
    elif user.role == UserRole.student:
        query = query.where(LiveClass.class_id.in_(select(ClassEnrollment.class_id).where(ClassEnrollment.student_id == user.id)))
    query=ordered(query,params.sort,{'newest':LiveClass.scheduled_start.desc(),'oldest':LiveClass.scheduled_start.asc(),'name':func.lower(LiveClass.title).asc(),'active':(case((LiveClass.status == LiveClassStatus.ongoing,0),else_=1).asc(),LiveClass.scheduled_start.desc())},LiveClass.id)
    query,total=page_query(db,query,params.page,params.limit)
    return ok([_serialize(db,item) for item in db.scalars(query)],total=total,page=params.page,limit=params.limit)


@router.post('')
def create_live_class(payload: LiveClassCreate, db: Session = Depends(get_db), user: User = Depends(manager)):
    cls = db.get(Class, payload.class_id)
    if not cls or (user.role != UserRole.admin and cls.homeroom_teacher_id != user.id):
        fail(404, 'NOT_FOUND', 'Bạn chỉ được tạo buổi học cho lớp mình phụ trách.')
    item = LiveClass(id=uuid4(), **payload.model_dump(), teacher_id=cls.homeroom_teacher_id or user.id, status=LiveClassStatus.scheduled)
    db.add(item)
    db.commit()
    return ok(_serialize(db, item))


@router.post('/provider-webhook')
async def provider_webhook(request: Request, db: Session = Depends(get_db), provider: ClassroomProvider = Depends(get_classroom_provider)):
    body = await request.body()
    if len(body) > 262144:
        fail(413, 'WEBHOOK_TOO_LARGE', 'Payload too large')
    try:
        event = provider.webhook(body.decode('utf-8'), request.headers.get('authorization', ''))
    except Exception:
        fail(401, 'INVALID_WEBHOOK', 'Invalid provider signature')
    if event.event not in ('participant_joined', 'participant_left') or not event.room.name.startswith('classroom-'):
        return ok({'received': True})
    try:
        session_id = UUID(event.room.name.removeprefix('classroom-'))
        identity = UUID(event.participant.identity)
    except ValueError:
        return ok({'received': True})
    item = await asyncio.to_thread(_locked_scalar, db, select(LiveClass).where(LiveClass.id == session_id))
    user = db.get(User, identity)
    if not item:
        return ok({'received': True})
    at = datetime.fromtimestamp(event.created_at, timezone.utc)
    if event.event == 'participant_joined':
        if item.deleted_at or item.status != LiveClassStatus.ongoing or not user or not user.is_active or not _authorized(db, item, user):
            await provider.remove(event.room.name, str(identity))
        elif user.role == UserRole.student:
            current = await provider.participant(event.room.name, str(identity))
            if current and current.sid == event.participant.sid:
                connected(db, item.id, user.id, current.sid, at)
    elif user and user.role == UserRole.student:
        disconnected(db, item.id, user.id, event.participant.sid, at)
    db.commit()
    return ok({'received': True})


@router.get('/{live_class_id}')
def get_live_class(live_class_id: UUID, db: Session = Depends(get_db), user: User = Depends(member)):
    item = _get_live_class(db, live_class_id)
    _access(db, item, user)
    return ok(_serialize(db, item))


@router.post('/{live_class_id}/start')
async def start_live_class(live_class_id: UUID, db: Session = Depends(get_db), user: User = Depends(manager), provider: ClassroomProvider = Depends(get_classroom_provider)):
    item = await asyncio.to_thread(_get_live_class, db, live_class_id, lock=True)
    _access(db, item, user, manage=True)
    if item.status != LiveClassStatus.scheduled:
        fail(409, 'INVALID_SESSION_STATE', 'Chỉ có thể bắt đầu buổi học đang được lên lịch.')
    await provider.ensure_room(room_name(item.id))
    item.status = LiveClassStatus.ongoing
    item.actual_start = datetime.now(timezone.utc)
    item.meeting_url = f'/live-class/{item.id}'
    item.updated_at = item.actual_start
    db.commit()
    return ok(_serialize(db, item))


@router.post('/{live_class_id}/end')
async def end_live_class(live_class_id: UUID, db: Session = Depends(get_db), user: User = Depends(manager)):
    item = await asyncio.to_thread(_get_live_class, db, live_class_id, lock=True)
    _access(db, item, user, manage=True)
    if item.status not in (LiveClassStatus.ongoing, LiveClassStatus.ended):
        fail(409, 'INVALID_SESSION_STATE', 'Buổi học chưa bắt đầu.')
    now = datetime.now(timezone.utc)
    for row in db.scalars(select(ClassAttendance).where(ClassAttendance.live_class_id == item.id).with_for_update()):
        close_interval(row, now)
    item.status = LiveClassStatus.ended
    item.actual_end = item.actual_end or now
    item.updated_at = now
    item.provider_close_pending = True
    db.commit()
    try:
        await get_classroom_provider().close_room(room_name(item.id))
        item.provider_close_pending = False
        db.commit()
    except HTTPException:
        pass
    return ok(_serialize(db, item))


@router.post('/{live_class_id}/token')
async def room_token(live_class_id: UUID, response: Response, db: Session = Depends(get_db), user: User = Depends(member), provider: ClassroomProvider = Depends(get_classroom_provider)):
    item = await asyncio.to_thread(_get_live_class, db, live_class_id, lock=True)
    trace_room('session_loaded', item)
    try:
        _access(db, item, user, live=True)
        trace_room('authorized', item)
        trace_room('provider_request', item, server_url_configured=bool(get_settings().LIVEKIT_URL))
        await provider.ensure_room(room_name(item.id))
        try:
            result = provider.token(room_name(item.id), str(user.id), user.full_name)
        except HTTPException:
            raise
        except Exception:
            fail(500, 'TOKEN_REQUEST_FAILED', 'Không tạo được quyền truy cập phòng học.')
    except HTTPException as exc:
        trace_room('token_failed', item, token_request_status=exc.status_code,
                   safe_error_code=exc.detail.get('code', 'TOKEN_REQUEST_FAILED') if isinstance(exc.detail, dict) else 'TOKEN_REQUEST_FAILED')
        raise
    response.headers['Cache-Control'] = 'no-store'
    trace_room('token_issued', item, token_request_status=200, server_url_configured=bool(result.get('url')))
    return ok(result)


@router.post('/{live_class_id}/join')
async def join_live_class(live_class_id: UUID, payload: ClassroomConnection, db: Session = Depends(get_db), user: User = Depends(member), provider: ClassroomProvider = Depends(get_classroom_provider)):
    item = await asyncio.to_thread(_get_live_class, db, live_class_id, lock=True)
    _access(db, item, user, live=True)
    participant = await provider.participant(room_name(item.id), str(user.id))
    if not participant or participant.sid != payload.participant_sid:
        fail(409, 'PARTICIPANT_NOT_CONNECTED', 'Chưa xác nhận được kết nối phòng học. Vui lòng thử lại.')
    if user.role == UserRole.student:
        row = connected(db, item.id, user.id, participant.sid)
        db.commit()
        return ok({'joined_at': row.joined_at})
    return ok({'joined_at': None})


@router.post('/{live_class_id}/leave')
async def leave_live_class(live_class_id: UUID, payload: ClassroomConnection, db: Session = Depends(get_db), user: User = Depends(member), provider: ClassroomProvider = Depends(get_classroom_provider)):
    item = await asyncio.to_thread(_get_live_class, db, live_class_id, lock=True)
    if not _authorized(db, item, user) and not (user.role == UserRole.student and db.scalar(select(ClassAttendance.id).where(ClassAttendance.live_class_id == item.id, ClassAttendance.student_id == user.id))):
        fail(404, 'NOT_FOUND', 'Không tìm thấy buổi học.')
    try:
        current = await provider.participant(room_name(item.id), str(user.id))
        if current and current.sid == payload.participant_sid:
            await provider.remove(room_name(item.id), str(user.id))
    except HTTPException:
        return ok({'left_at': None, 'pending': True})
    row = disconnected(db, item.id, user.id, payload.participant_sid) if user.role == UserRole.student else None
    db.commit()
    return ok({'left_at': row.left_at if row else None})


@router.get('/{live_class_id}/attendance')
def attendance(live_class_id: UUID, db: Session = Depends(get_db), user: User = Depends(manager)):
    item = _get_live_class(db, live_class_id)
    _access(db, item, user, manage=True)
    roster = select(ClassEnrollment.student_id).where(ClassEnrollment.class_id == item.class_id)
    rows = db.execute(select(User, ClassAttendance).outerjoin(ClassAttendance, and_(ClassAttendance.student_id == User.id, ClassAttendance.live_class_id == item.id)).where(User.id.in_(roster) | ClassAttendance.id.is_not(None)).order_by(User.full_name)).all()
    now = datetime.now(timezone.utc)
    return ok([{'student_id': student.id, 'full_name': student.full_name,
                'joined_at': row.joined_at if row else None, 'left_at': row.left_at if row else None,
                'duration_sec': ((row.duration_sec or 0) + max(0, int((now - utc(row.active_since)).total_seconds())) if row and row.active_since else (row.duration_sec or 0) if row else 0),
                'status': row.status if row else 'absent'} for student, row in rows])
