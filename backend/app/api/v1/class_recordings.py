"""Authenticated metadata and short-lived, revocable range playback."""
import asyncio
from datetime import timedelta
import re
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from jose import jwt, JWTError
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.api.deps import current_user
from app.api.responses import ok
from app.api.v1 import live_classes as classrooms
from app.core.config import get_settings
from app.core.database import get_db, SessionLocal
from app.models.entities import ClassRecording, User, UserRole
from app.services import class_recordings as service
from app.services.classroom_attendance import utc
from app.services.recording_provider import get_recording_provider
from app.services.recording_storage import get_recording_storage

router = APIRouter()
PRIVATE = {'Cache-Control': 'private, no-store', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'}


def recording(db, identifier, user, *, manage=False):
    row = db.scalar(select(ClassRecording).where(ClassRecording.id == identifier).with_for_update() if manage else select(ClassRecording).where(ClassRecording.id == identifier))
    if not row or row.status == 'DELETED' or utc(row.expires_at) <= service.now():
        service.fail('RECORDING_NOT_FOUND', 'Không tìm thấy bản ghi hoặc bạn không có quyền truy cập.', 404)
    item = classrooms._get_live_class(db, row.live_class_id)
    classrooms._access(db, item, user, manage=manage)
    if user.role == UserRole.student and row.status != 'PUBLISHED':
        service.fail('RECORDING_NOT_FOUND', 'Không tìm thấy bản ghi hoặc bạn không có quyền truy cập.', 404)
    return row, item


@router.post('/live-classes/{live_class_id}/recording/start')
async def start(live_class_id: UUID, db: Session = Depends(get_db), user: User = Depends(classrooms.manager), provider=Depends(get_recording_provider)):
    item = await asyncio.to_thread(classrooms._get_live_class, db, live_class_id, lock=True)
    classrooms._access(db, item, user, manage=True, live=True)
    return ok(service.public_record(await service.start(db, item, user, provider)))


@router.post('/live-classes/{live_class_id}/recording/stop')
async def stop(live_class_id: UUID, db: Session = Depends(get_db), user: User = Depends(classrooms.manager), provider=Depends(get_recording_provider)):
    item = classrooms._get_live_class(db, live_class_id)
    classrooms._access(db, item, user, manage=True)
    row = await asyncio.to_thread(db.scalar, select(ClassRecording).where(ClassRecording.live_class_id == item.id, ClassRecording.status.in_(service.ACTIVE)).with_for_update())
    return ok(service.public_record(await service.stop(db, row, user, provider)) if row else None)


@router.get('/live-classes/{live_class_id}/recordings')
async def listing(live_class_id: UUID, db: Session = Depends(get_db), user: User = Depends(classrooms.member), provider=Depends(get_recording_provider)):
    item = classrooms._get_live_class(db, live_class_id)
    classrooms._access(db, item, user)
    managed = classrooms._managed(db, item, user)
    query = select(ClassRecording).where(ClassRecording.live_class_id == item.id, ClassRecording.status != 'DELETED', ClassRecording.expires_at > service.now())
    all_rows = list(db.scalars(query.order_by(ClassRecording.created_at)))
    visible = all_rows if managed else [row for row in all_rows if row.status == 'PUBLISHED']
    return ok({'recordings': [service.public_record(row) for row in visible], 'recorded': bool(all_rows),
        'processing': any(row.status in service.PENDING for row in all_rows),
        'available': bool(managed and await provider.available())})


@router.get('/recordings/{recording_id}')
def detail(recording_id: UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row, item = recording(db, recording_id, user)
    return ok(service.public_record(row) | {'session': classrooms._serialize(db, item, user)})


@router.post('/recordings/{recording_id}/publish')
def publish(recording_id: UUID, db: Session = Depends(get_db), user: User = Depends(classrooms.manager)):
    row, _ = recording(db, recording_id, user, manage=True)
    return ok(service.public_record(service.publish(db, row, user)))


@router.post('/recordings/{recording_id}/unpublish')
def unpublish(recording_id: UUID, db: Session = Depends(get_db), user: User = Depends(classrooms.manager)):
    row, _ = recording(db, recording_id, user, manage=True)
    return ok(service.public_record(service.unpublish(db, row, user)))


@router.delete('/recordings/{recording_id}')
def delete(recording_id: UUID, db: Session = Depends(get_db), user: User = Depends(classrooms.manager)):
    # Repeated deletion remains successful without restoring access.
    row = db.get(ClassRecording, recording_id)
    if row and row.status == 'DELETED':
        item = classrooms._get_live_class(db, row.live_class_id); classrooms._access(db, item, user, manage=True)
    else:
        row, _ = recording(db, recording_id, user, manage=True)
    service.delete(db, row, user)
    return ok({'deleted': True, 'cleanup_pending': row.delete_pending})


@router.get('/recordings/{recording_id}/playback')
def playback(recording_id: UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row, _ = recording(db, recording_id, user)
    if row.status not in service.PLAYABLE:
        service.fail('RECORDING_NOT_READY', 'Bản ghi đang được xử lý.')
    try:
        if get_recording_storage().validate(row.storage_key) != row.file_size_bytes:
            raise OSError('Recording size changed')
    except (OSError, ValueError):
        service.fail('RECORDING_MEDIA_MISSING', 'Không tìm thấy tệp bản ghi.', 404)
    settings = get_settings()
    expires = service.now() + timedelta(seconds=settings.RECORDING_PLAYBACK_TTL_SECONDS)
    ticket = jwt.encode({'sub': str(user.id), 'rid': str(row.id), 'version': row.access_version,
        'purpose': 'class-recording-playback', 'exp': expires}, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return ok({'media_path': f'/recordings/{row.id}/media?ticket={ticket}', 'expires_at': expires})


def ticket_access(db, identifier, ticket):
    try:
        settings = get_settings()
        claims = jwt.decode(ticket, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        if claims.get('purpose') != 'class-recording-playback' or claims.get('rid') != str(identifier):
            raise ValueError()
        user = db.get(User, UUID(claims['sub']))
        if not user or not user.is_active:
            raise ValueError()
        row, _ = recording(db, identifier, user)
        if row.access_version != claims.get('version') or row.status not in service.PLAYABLE:
            raise ValueError()
        return row
    except (JWTError, ValueError, KeyError, TypeError):
        service.fail('PLAYBACK_EXPIRED', 'Quyền xem đã hết hạn. Vui lòng mở lại bản ghi.', 401)


@router.get('/recordings/{recording_id}/media', name='class_recording_media')
def media(recording_id: UUID, request: Request, ticket: str = Query(min_length=1, max_length=4096), db: Session = Depends(get_db)):
    request.scope['query_string'] = b''  # Never put playback credentials in access logs.
    row = ticket_access(db, recording_id, ticket)
    try:
        size = get_recording_storage().validate(row.storage_key); path = get_recording_storage().path(row.storage_key)
        if size != row.file_size_bytes:
            raise OSError('Recording size changed')
    except (OSError, ValueError):
        service.fail('RECORDING_MEDIA_MISSING', 'Không tìm thấy tệp bản ghi.', 404)
    start, end = 0, size - 1
    requested = request.headers.get('range')
    def invalid_range():
        raise HTTPException(416, detail={'code': 'INVALID_RANGE', 'message': 'Vùng phát không hợp lệ.'}, headers=PRIVATE | {'Content-Range': f'bytes */{size}'})
    if requested:
        if len(requested) > 100:
            invalid_range()
        match = re.fullmatch(r'bytes=(\d*)-(\d*)', requested)
        if not match or not any(match.groups()):
            invalid_range()
        first, last = match.groups()
        start = int(first) if first else max(0, size - int(last))
        end = min(size - 1, int(last)) if first and last else size - 1
        if start >= size or start > end:
            invalid_range()
    # Bound each response; every subsequent range rechecks enrollment and publication.
    if requested:
        end = min(end, start + 4 * 1024 * 1024 - 1)
    def chunks():
        with path.open('rb') as source:
            source.seek(start); remaining = end - start + 1
            while remaining:
                # Revoke even an already-open stream, rather than trusting its old ticket.
                with SessionLocal() as check:
                    try: ticket_access(check, recording_id, ticket)
                    except HTTPException: return
                block = source.read(min(256 * 1024, remaining))
                if not block: return
                remaining -= len(block)
                yield block
    headers = PRIVATE | {'Accept-Ranges': 'bytes', 'Content-Length': str(end - start + 1), 'Content-Disposition': 'inline'}
    if requested:
        headers['Content-Range'] = f'bytes {start}-{end}/{size}'
    return StreamingResponse(chunks(), status_code=206 if requested else 200, media_type='video/mp4', headers=headers)
