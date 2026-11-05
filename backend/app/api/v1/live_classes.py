import asyncio
import logging
import json
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
from app.schemas.live_classes import ClassroomConnection, LiveClassCreate, ClassroomPolicyPatch, ClassroomAction, ClassroomHand, ClassroomMessage
from app.services.classroom_controls import state, project
from app.services.notifications import create_notification
from app.services.classroom_attendance import close_interval, connected, disconnected, utc
from app.services.classroom_provider import ClassroomProvider, get_classroom_provider, room_name
from app.services import class_recordings

router = APIRouter()
member = roles(UserRole.admin, UserRole.teacher, UserRole.student)
manager = roles(UserRole.admin, UserRole.teacher)


def _entry(item, user, host):
    if host:
        return
    value = state(item)
    member_state = value['members'].get(str(user.id), {})
    admission = member_state.get('admission')
    if admission in ('removed', 'rejected'):
        fail(409, 'REMOVED_BY_TEACHER' if admission == 'removed' else 'ADMISSION_REJECTED', 'Giảng viên đã từ chối quyền tham gia buổi học này.')
    if value['policy']['locked'] and not member_state.get('entered'):
        fail(409, 'ROOM_LOCKED', 'Lớp học hiện đã được khóa bởi giảng viên.')
    if value['policy']['waiting_room'] and admission != 'admitted':
        fail(409, 'WAITING_FOR_ADMISSION', 'Đang chờ giảng viên cho vào lớp.')


def _entry_allowed(item, user, host):
    try:
        _entry(item, user, host)
        return True
    except HTTPException:
        return False
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
    query = select(LiveClass).where(LiveClass.id == session_id, LiveClass.deleted_at.is_(None)).execution_options(populate_existing=True)
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


def _serialize(db, item, user=None):
    cls = db.get(Class, item.class_id)
    teacher = db.get(User, item.teacher_id)
    return {key: getattr(item, key) for key in ('id', 'class_id', 'teacher_id', 'title', 'description', 'scheduled_start', 'scheduled_end', 'actual_start', 'actual_end', 'meeting_url', 'recording_url', 'status', 'deleted_at', 'created_at', 'updated_at')} | {
        'class_name': cls.name if cls else None, 'teacher_name': teacher.full_name if teacher else None,
        'provider_close_pending': item.provider_close_pending,
        'policy': state(item)['policy'],
        'admission': state(item)['members'].get(str(user.id), {}).get('admission') if user else None,
        'waiting': [{'id': key, 'name': value['name'], 'requested_at': value['requested_at']} for key, value in state(item)['members'].items() if value.get('admission') == 'waiting'] if user and _managed(db, item, user) else [],
        **class_recordings.summary(db, item),
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
    return ok([_serialize(db,item,user) for item in db.scalars(query)],total=total,page=params.page,limit=params.limit)


@router.post('')
def create_live_class(payload: LiveClassCreate, db: Session = Depends(get_db), user: User = Depends(manager)):
    cls = db.get(Class, payload.class_id)
    if not cls or (user.role != UserRole.admin and cls.homeroom_teacher_id != user.id):
        fail(404, 'NOT_FOUND', 'Bạn chỉ được tạo buổi học cho lớp mình phụ trách.')
    item = LiveClass(id=uuid4(), **payload.model_dump(), teacher_id=cls.homeroom_teacher_id or user.id, status=LiveClassStatus.scheduled)
    db.add(item)
    db.commit()
    return ok(_serialize(db, item, user))


@router.post('/provider-webhook')
async def provider_webhook(request: Request, db: Session = Depends(get_db), provider: ClassroomProvider = Depends(get_classroom_provider)):
    body = await request.body()
    if len(body) > 262144:
        fail(413, 'WEBHOOK_TOO_LARGE', 'Payload too large')
    try:
        event = provider.webhook(body.decode('utf-8'), request.headers.get('authorization', ''))
    except Exception:
        fail(401, 'INVALID_WEBHOOK', 'Invalid provider signature')
    if event.event in ('egress_started', 'egress_updated', 'egress_ended'):
        await class_recordings.handle_webhook(db, event.egress_info)
        return ok({'received': True})
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
        if item.deleted_at or item.status != LiveClassStatus.ongoing or not user or not user.is_active or not _authorized(db, item, user) or not _entry_allowed(item, user, _managed(db, item, user)):
            await provider.remove(event.room.name, str(identity))
        elif user.role == UserRole.student:
            current = await provider.participant(event.room.name, str(identity))
            if current and current.sid == event.participant.sid:
                connected(db, item.id, user.id, current.sid, at)
    elif user and user.role == UserRole.student:
        row = disconnected(db, item.id, user.id, event.participant.sid, at)
        if row and row.participant_sid == event.participant.sid:
            value = state(item)
            own = value['members'].get(str(user.id))
            if own:
                own.update({'entered': False, 'hand': None})
                item.classroom_state = value
    db.commit()
    return ok({'received': True})


@router.get('/{live_class_id}')
def get_live_class(live_class_id: UUID, db: Session = Depends(get_db), user: User = Depends(member)):
    item = _get_live_class(db, live_class_id)
    _access(db, item, user)
    return ok(_serialize(db, item, user))


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
    for student_id in db.scalars(select(ClassEnrollment.student_id).where(ClassEnrollment.class_id == item.class_id)):
        create_notification(db, student_id, 'classroom_activity', 'Lớp học đã bắt đầu', f'Lớp học {item.title} đã bắt đầu.', send_email=False)
    db.commit()
    return ok(_serialize(db, item, user))


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
        # Durable stop intent precedes room deletion. RoomComposite also follows
        # room closure; reconciliation handles a lost stop response/webhook.
        await class_recordings.stop_for_class(db, item.id, user)
        await get_classroom_provider().close_room(room_name(item.id))
        # DeleteRoom emits leave webhooks which may now own this row. Acquire
        # the lock outside the event loop again before clearing the close flag;
        # a synchronous UPDATE here would stop the webhook from releasing it.
        item = await asyncio.to_thread(_get_live_class, db, live_class_id, lock=True)
        item.provider_close_pending = False
        class_recordings.room_closed(db, item.id)
        db.commit()
    except HTTPException:
        pass
    return ok(_serialize(db, item, user))


@router.post('/{live_class_id}/token')
async def room_token(live_class_id: UUID, response: Response, db: Session = Depends(get_db), user: User = Depends(member), provider: ClassroomProvider = Depends(get_classroom_provider)):
    item = await asyncio.to_thread(_get_live_class, db, live_class_id, lock=True)
    trace_room('session_loaded', item)
    try:
        _access(db, item, user, live=True)
        _entry(item, user, _managed(db, item, user))
        trace_room('authorized', item)
        trace_room('provider_request', item, server_url_configured=bool(get_settings().LIVEKIT_URL))
        await provider.ensure_room(room_name(item.id))
        try:
            result = provider.token(room_name(item.id), str(user.id), user.full_name, policy=state(item)['policy'], host=_managed(db, item, user))
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
    _entry(item, user, _managed(db, item, user))
    participant = await provider.participant(room_name(item.id), str(user.id))
    if not participant or participant.sid != payload.participant_sid:
        fail(409, 'PARTICIPANT_NOT_CONNECTED', 'Chưa xác nhận được kết nối phòng học. Vui lòng thử lại.')
    value = state(item)
    member_state = value['members'].setdefault(str(user.id), {})
    member_state.update({'entered': True, 'admission': 'admitted'})
    item.classroom_state = value
    await provider.permissions(item, participant, value)
    if user.role == UserRole.student:
        row = connected(db, item.id, user.id, participant.sid)
        db.commit()
        return ok({'joined_at': row.joined_at})
    db.commit()
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
    if not current or current.sid == payload.participant_sid:
        value = state(item)
        own = value['members'].get(str(user.id), {})
        own['entered'] = False
        own['hand'] = None
        item.classroom_state = value
    db.commit()
    return ok({'left_at': row.left_at if row else None})


@router.post('/{live_class_id}/admission')
async def request_admission(live_class_id: UUID, db: Session = Depends(get_db), user: User = Depends(member)):
    item = await asyncio.to_thread(_get_live_class, db, live_class_id, lock=True)
    _access(db, item, user, live=True)
    if _managed(db, item, user):
        return ok({'status': 'admitted'})
    value = state(item)
    own = value['members'].setdefault(str(user.id), {})
    if own.get('admission') in ('removed', 'rejected'):
        _entry(item, user, False)
    if value['policy']['locked'] and not own.get('entered'):
        fail(409, 'ROOM_LOCKED', 'Lớp học hiện đã được khóa bởi giảng viên.')
    if not value['policy']['waiting_room']:
        own['admission'] = 'admitted'
    elif own.get('admission') != 'admitted':
        own.update({'admission': 'waiting', 'name': user.full_name, 'requested_at': own.get('requested_at') or datetime.now(timezone.utc).isoformat()})
    item.classroom_state = value
    db.commit()
    return ok({'status': own['admission']})


@router.post('/{live_class_id}/policy')
async def update_policy(live_class_id: UUID, payload: ClassroomPolicyPatch, db: Session = Depends(get_db), user: User = Depends(manager), provider: ClassroomProvider = Depends(get_classroom_provider)):
    item = await asyncio.to_thread(_get_live_class, db, live_class_id, lock=True)
    _access(db, item, user, manage=True, live=True)
    value = state(item)
    value['policy'].update(payload.model_dump(exclude_none=True))
    item.classroom_state = value
    # Persist first: no token may bypass a restriction if SFU projection fails.
    item.controls_sync_pending = True
    db.commit()
    item = await asyncio.to_thread(_get_live_class, db, live_class_id, lock=True)
    _access(db, item, user, manage=True, live=True)
    await project(provider, item)
    item.controls_sync_pending = False
    db.commit()
    return ok(_serialize(db, item, user))


@router.delete('/{live_class_id}/admission')
async def cancel_admission(live_class_id: UUID, db: Session = Depends(get_db), user: User = Depends(member)):
    item = await asyncio.to_thread(_get_live_class, db, live_class_id, lock=True)
    _access(db, item, user)
    value = state(item)
    if value['members'].get(str(user.id), {}).get('admission') == 'waiting':
        del value['members'][str(user.id)]
        item.classroom_state = value
        db.commit()
    return ok({'cancelled': True})


@router.post('/{live_class_id}/actions')
async def host_action(live_class_id: UUID, payload: ClassroomAction, db: Session = Depends(get_db), user: User = Depends(manager), provider: ClassroomProvider = Depends(get_classroom_provider)):
    item = await asyncio.to_thread(_get_live_class, db, live_class_id, lock=True)
    _access(db, item, user, manage=True, live=True)
    value = state(item)
    action = payload.action
    target = str(payload.participant_id) if payload.participant_id else None
    if action not in ('admit_all', 'mute_all', 'lower_all'):
        student = db.get(User, payload.participant_id) if target else None
        if not student or student.role != UserRole.student or not _authorized(db, item, student):
            fail(404, 'NOT_FOUND', 'Không tìm thấy sinh viên trong lớp.')
    identities = [key for key, member_state in value['members'].items() if member_state.get('admission') == 'waiting'] if action == 'admit_all' else [target] if target else []
    if action in ('admit', 'admit_all', 'reject', 'remove'):
        if action.startswith('admit') and value['policy']['locked']:
            fail(409, 'ROOM_LOCKED', 'Hãy mở khóa lớp trước khi cho sinh viên vào.')
        for identity in identities:
            own = value['members'].setdefault(identity, {})
            if action in ('admit', 'admit_all', 'reject') and own.get('admission') != 'waiting':
                fail(409, 'NOT_WAITING', 'Sinh viên không còn trong phòng chờ.')
            own['admission'] = 'removed' if action == 'remove' else 'rejected' if action == 'reject' else 'admitted'
    if action == 'request_unmute' and not value['policy']['unmute']:
        fail(409, 'UNMUTE_DISABLED', 'Hãy cho phép sinh viên bật micro trước.')
    if action in ('lower_hand', 'lower_all'):
        for identity, member_state in value['members'].items():
            if action == 'lower_all' or identity == target:
                member_state['hand'] = None
    if action in ('admit', 'admit_all', 'request_unmute'):
        for identity in identities:
            create_notification(db, UUID(identity), 'classroom_activity', 'Thông báo lớp học',
                f'Giảng viên yêu cầu bạn bật micro trong lớp {item.title}.' if action == 'request_unmute' else f'Bạn đã được cho vào lớp {item.title}.', send_email=False)
    item.classroom_state = value
    item.controls_sync_pending = True
    db.commit()
    item = await asyncio.to_thread(_get_live_class, db, live_class_id, lock=True)
    _access(db, item, user, manage=True, live=True)
    name = room_name(item.id)
    if action == 'remove':
        await provider.send(name, 'classroom-control', {'type': 'removed'}, identities)
        await provider.remove(name, target)
        row = db.scalar(select(ClassAttendance).where(ClassAttendance.live_class_id == item.id, ClassAttendance.student_id == payload.participant_id).with_for_update())
        if row:
            close_interval(row, datetime.now(timezone.utc))
    elif action in ('mute', 'mute_all'):
        for participant in await provider.participants(name):
            # Host actions only target students; signed host metadata also protects admins.
            try:
                is_host = json.loads(participant.metadata or '{}').get('host') is True
            except ValueError:
                is_host = False
            if participant.identity != str(item.teacher_id) and not is_host and (action == 'mute_all' or participant.identity == target):
                await provider.mute(name, participant)
    elif action == 'request_unmute':
        if not value['policy']['unmute']:
            fail(409, 'UNMUTE_DISABLED', 'Hãy cho phép sinh viên bật micro trước.')
        await provider.send(name, 'classroom-control', {'type': 'request_unmute'}, identities)
    await project(provider, item)
    item.controls_sync_pending = False
    db.commit()
    return ok(_serialize(db, item, user))


@router.post('/{live_class_id}/hand')
async def raise_hand(live_class_id: UUID, payload: ClassroomHand, db: Session = Depends(get_db), user: User = Depends(member), provider: ClassroomProvider = Depends(get_classroom_provider)):
    item = await asyncio.to_thread(_get_live_class, db, live_class_id, lock=True)
    _access(db, item, user, live=True)
    _entry(item, user, _managed(db, item, user))
    participant = await provider.participant(room_name(item.id), str(user.id))
    if not participant:
        fail(409, 'PARTICIPANT_NOT_CONNECTED', 'Bạn cần kết nối phòng học trước.')
    value = state(item)
    own = value['members'].setdefault(str(user.id), {})
    own['hand'] = (own.get('hand') or datetime.now(timezone.utc).isoformat()) if payload.raised else None
    item.classroom_state = value
    await provider.permissions(item, participant, value)
    db.commit()
    return ok({'raised_at': own['hand']})


@router.post('/{live_class_id}/chat')
async def send_chat(live_class_id: UUID, payload: ClassroomMessage, db: Session = Depends(get_db), user: User = Depends(member), provider: ClassroomProvider = Depends(get_classroom_provider)):
    item = await asyncio.to_thread(_get_live_class, db, live_class_id, lock=True)
    host = _managed(db, item, user)
    _access(db, item, user, live=True)
    _entry(item, user, host)
    if not host and not state(item)['policy']['chat']:
        fail(409, 'CHAT_DISABLED', 'Giảng viên đã tắt trò chuyện.')
    if not await provider.participant(room_name(item.id), str(user.id)):
        fail(409, 'PARTICIPANT_NOT_CONNECTED', 'Bạn cần kết nối phòng học trước.')
    if not payload.text.strip():
        fail(422, 'EMPTY_MESSAGE', 'Nhập nội dung tin nhắn.')
    message = {'id': str(uuid4()), 'sender': str(user.id), 'name': user.full_name, 'text': payload.text.strip(), 'time': int(datetime.now(timezone.utc).timestamp() * 1000)}
    await provider.send(room_name(item.id), 'classroom-chat', message)
    return ok(message)


@router.get('/{live_class_id}/attendance')
def attendance(live_class_id: UUID, db: Session = Depends(get_db), user: User = Depends(manager)):
    item = _get_live_class(db, live_class_id)
    _access(db, item, user, manage=True)
    roster = select(ClassEnrollment.student_id).where(ClassEnrollment.class_id == item.class_id)
    rows = db.execute(select(User, ClassAttendance).outerjoin(ClassAttendance, and_(ClassAttendance.student_id == User.id, ClassAttendance.live_class_id == item.id)).where(User.id.in_(roster) | ClassAttendance.id.is_not(None)).order_by(User.full_name)).all()
    now = datetime.now(timezone.utc)
    return ok([{'student_id': student.id, 'student_code': student.student_code, 'full_name': student.full_name,
                'joined_at': row.joined_at if row else None, 'left_at': row.left_at if row else None,
                'duration_sec': ((row.duration_sec or 0) + max(0, int((now - utc(row.active_since)).total_seconds())) if row and row.active_since else (row.duration_sec or 0) if row else 0),
                'status': row.status if row else 'absent'} for student, row in rows])
