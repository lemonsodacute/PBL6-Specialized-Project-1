"""Durable recording lifecycle. Provider acknowledgements own media state."""
import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import PurePosixPath
import logging
from uuid import uuid4
from fastapi import HTTPException
from sqlalchemy import select
from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.entities import AuditLog, ClassEnrollment, ClassRecording, LiveClass, LiveClassStatus
from app.services.classroom_attendance import utc
from app.services.classroom_provider import get_classroom_provider, room_name
from app.services.notifications import create_notification
from app.services.recording_provider import get_recording_provider
from app.services.recording_storage import get_recording_storage

log = logging.getLogger(__name__)
ACTIVE = ('STARTING', 'RECORDING')
PENDING = (*ACTIVE, 'PROCESSING')
PLAYABLE = ('READY', 'PUBLISHED', 'UNPUBLISHED')


def now():
    return datetime.now(timezone.utc)


def fail(code, message, status=409):
    raise HTTPException(status, detail={'code': code, 'message': message})


def audit(db, row, action, actor=None):
    item = db.get(LiveClass, row.live_class_id)
    db.add(AuditLog(id=uuid4(), user_id=actor, action=action, entity_type='class_recording', entity_id=row.id,
                    metadata_json={'live_class_id': str(row.live_class_id), 'class_id': str(item.class_id)}))


def public_record(row):
    return {key: getattr(row, key) for key in ('id', 'live_class_id', 'status', 'started_at', 'stopped_at',
        'duration_seconds', 'file_size_bytes', 'published_at', 'created_at', 'updated_at', 'expires_at', 'error_code')}


def summary(db, item):
    rows = list(db.scalars(select(ClassRecording).where(ClassRecording.live_class_id == item.id,
        ClassRecording.status != 'DELETED', ClassRecording.expires_at > now()).order_by(ClassRecording.created_at.desc())))
    active = next((row for row in rows if row.status in ACTIVE), None)
    latest = active or (rows[0] if rows else None)
    published = next((row for row in rows if row.status == 'PUBLISHED'), None)
    return {'has_published_recording': bool(published), 'published_recording_id': published.id if published else None,
        'recording': {'id': active.id if active else None, 'status': latest.status if latest else 'NOT_STARTED',
            'active': bool(active and active.status == 'RECORDING'), 'started_at': active.started_at if active else None,
            'available': get_settings().CLASS_RECORDING_ENABLED,
            'updated_at': latest.updated_at if latest else None}}


async def broadcast(db, item):
    from fastapi.encoders import jsonable_encoder
    try:
        await get_classroom_provider().send(room_name(item.id), 'classroom-recording', jsonable_encoder(summary(db, item)['recording']))
    except Exception:
        # HTTP detail polling is the fallback when the room is already closed.
        log.info('Recording state broadcast deferred')


def _keys(info):
    keys = {PurePosixPath(result.filename).name for result in info.file_results}
    keys.update(PurePosixPath(output.file.filepath).name for output in info.egress.outputs if output.HasField('file'))
    request = info.room_composite
    keys.update(PurePosixPath(output.filepath).name for output in request.file_outputs)
    if request.HasField('file'):
        keys.add(PurePosixPath(request.file.filepath).name)
    return keys


def apply_info(db, row, info):
    """Idempotent for duplicate/out-of-order signed events and poll responses."""
    if info.room_name != room_name(row.live_class_id):
        return
    if row.provider_recording_id and row.provider_recording_id != info.egress_id:
        return
    if row.storage_key not in _keys(info):
        return
    if row.status in ('DELETED', 'PUBLISHED', 'UNPUBLISHED', 'READY', 'FAILED'):
        return
    row.provider_recording_id = info.egress_id
    if info.status == 1 and not row.stop_requested_at:  # EGRESS_ACTIVE
        if not row.started_at:
            row.started_at = datetime.fromtimestamp(info.started_at / 1e9, timezone.utc) if info.started_at else now()
            audit(db, row, 'RECORDING_STARTED', row.started_by)
        row.status = 'RECORDING'; row.error_code = None
    elif info.status == 2:  # EGRESS_ENDING
        row.status = 'PROCESSING'; row.error_code = None
        row.stopped_at = row.stopped_at or now()
        if not row.stop_requested_at:
            row.stop_requested_at = row.stopped_at
            audit(db, row, 'RECORDING_STOPPED')
    elif info.status in (3, 6):  # COMPLETE or a finalized duration-limited file
        row.stopped_at = datetime.fromtimestamp(info.ended_at / 1e9, timezone.utc) if info.ended_at else row.stopped_at or now()
        if not row.started_at and info.started_at:
            row.started_at = datetime.fromtimestamp(info.started_at / 1e9, timezone.utc)
            audit(db, row, 'RECORDING_STARTED', row.started_by)
        if not row.stop_requested_at:
            row.stop_requested_at = row.stopped_at
            audit(db, row, 'RECORDING_STOPPED')
        try:
            size = get_recording_storage().validate(row.storage_key)
            result = next(result for result in info.file_results if PurePosixPath(result.filename).name == row.storage_key)
            if result.duration <= 0 or result.size <= 0 or size != result.size:
                raise OSError('Incomplete provider output')
            row.duration_seconds = max(1, int(result.duration / 1e9))
            row.file_size_bytes = size
            row.status = 'READY'; row.error_code = None
        except (OSError, ValueError, StopIteration):
            row.status = 'PROCESSING' if (now() - utc(row.stopped_at)).total_seconds() < 60 else 'FAILED'
            row.error_code = 'MEDIA_MISSING'
    elif info.status in (4, 5):
        row.status = 'FAILED'; row.error_code = 'PROCESSING_FAILED'; row.stopped_at = row.stopped_at or now()
    row.updated_at = now()


async def start(db, item, actor, provider):
    if not await provider.available():
        fail('RECORDING_UNAVAILABLE', 'Ghi hình hiện không khả dụng.', 503)
    existing = db.scalar(select(ClassRecording).where(ClassRecording.live_class_id == item.id, ClassRecording.status.in_(ACTIVE)))
    if existing:
        fail('RECORDING_ALREADY_ACTIVE', 'Buổi học đang có một bản ghi hoạt động.')
    identifier = uuid4()
    row = ClassRecording(id=identifier, live_class_id=item.id, started_by=actor.id, storage_key=f'{identifier}.mp4',
        status='STARTING', expires_at=now() + timedelta(days=get_settings().RECORDING_RETENTION_DAYS),
        access_version=1, delete_pending=False, created_at=now(), updated_at=now())
    db.add(row)
    await asyncio.to_thread(db.commit)  # Persist intent before an ambiguous provider timeout.
    try:
        info = await provider.start(room_name(item.id), row.storage_key)
        await asyncio.to_thread(db.refresh, row, with_for_update=True)
        apply_info(db, row, info)
        await asyncio.to_thread(db.commit)
    except HTTPException:
        row.error_code = 'START_PENDING'; row.updated_at = now(); await asyncio.to_thread(db.commit)
        # Keep STARTING: the provider may have accepted a request whose response timed out.
    await broadcast(db, item)
    return row


async def stop(db, row, actor, provider):
    if row.status not in ACTIVE:
        return row
    if not row.stop_requested_at:
        row.stop_requested_at = now()
        audit(db, row, 'RECORDING_STOPPED', actor.id if actor else None)
        await asyncio.to_thread(db.commit)
    # A retry may have selected FOR UPDATE after a previous stop intent. Release
    # that lock too, before waiting on Egress and its concurrent webhooks.
    await asyncio.to_thread(db.commit)
    if row.provider_recording_id:
        try:
            info = await provider.stop(row.provider_recording_id)
            await asyncio.to_thread(db.refresh, row, with_for_update=True)
            apply_info(db, row, info)
            if row.status in ACTIVE:
                row.status = 'PROCESSING'; row.stopped_at = row.stopped_at or now()
                row.error_code = None
            await asyncio.to_thread(db.commit)
        except HTTPException:
            row.error_code = 'STOP_PENDING'; row.updated_at = now(); await asyncio.to_thread(db.commit)
    await broadcast(db, db.get(LiveClass, row.live_class_id))
    return row


async def stop_for_class(db, class_id, actor=None):
    rows = list(db.scalars(select(ClassRecording).where(ClassRecording.live_class_id == class_id, ClassRecording.status.in_(ACTIVE))))
    for row in rows:
        await stop(db, row, actor, get_recording_provider())


def room_closed(db, class_id):
    for row in db.scalars(select(ClassRecording).where(ClassRecording.live_class_id == class_id, ClassRecording.status.in_(ACTIVE), ClassRecording.provider_recording_id.is_not(None))):
        row.status = 'PROCESSING'; row.stopped_at = row.stopped_at or now(); row.updated_at = now()


def publish(db, row, actor):
    if row.status == 'PUBLISHED':
        return row
    if row.status not in ('READY', 'UNPUBLISHED') or utc(row.expires_at) <= now():
        fail('RECORDING_NOT_READY', 'Bản ghi chưa sẵn sàng để công khai.')
    try:
        if get_recording_storage().validate(row.storage_key) != row.file_size_bytes:
            raise OSError('Recording size changed')
    except (OSError, ValueError):
        fail('RECORDING_MEDIA_MISSING', 'Không tìm thấy tệp bản ghi. Vui lòng liên hệ quản trị viên.')
    row.status = 'PUBLISHED'; row.published_at = now(); row.published_by = actor.id; row.updated_at = now()
    row.access_version += 1
    item = db.get(LiveClass, row.live_class_id)
    for student_id in db.scalars(select(ClassEnrollment.student_id).where(ClassEnrollment.class_id == item.class_id)):
        create_notification(db, student_id, 'classroom_activity', 'Bản ghi buổi học đã sẵn sàng',
            f'Bản ghi buổi học {item.title} đã sẵn sàng.', send_email=False)
    audit(db, row, 'RECORDING_PUBLISHED', actor.id)
    db.commit()
    return row


def unpublish(db, row, actor):
    if row.status == 'PUBLISHED':
        row.status = 'UNPUBLISHED'; row.access_version += 1; row.updated_at = now()
        audit(db, row, 'RECORDING_UNPUBLISHED', actor.id)
        db.commit()
    return row


def delete(db, row, actor=None):
    if row.status in PENDING:
        fail('RECORDING_STILL_ACTIVE', 'Hãy dừng ghi và chờ xử lý hoàn tất trước khi xóa.')
    if row.status != 'DELETED':
        row.status = 'DELETED'; row.access_version += 1; row.delete_pending = True; row.updated_at = now()
        audit(db, row, 'RECORDING_DELETED', actor.id if actor else None)
        db.commit()  # Revoke access even if storage is temporarily unavailable.
    if row.delete_pending:
        try:
            get_recording_storage().delete(row.storage_key)
            row.delete_pending = False; db.commit()
        except (OSError, ValueError):
            log.warning('Private classroom recording deletion pending')
    return row


async def handle_webhook(db, info):
    row = await asyncio.to_thread(db.scalar, select(ClassRecording).where(ClassRecording.provider_recording_id == info.egress_id).with_for_update()) if info.egress_id else None
    keys = _keys(info)
    if row is None and keys:
        row = await asyncio.to_thread(db.scalar, select(ClassRecording).where(ClassRecording.storage_key.in_(keys)).with_for_update())
    if row:
        apply_info(db, row, info); await asyncio.to_thread(db.commit)
        await broadcast(db, db.get(LiveClass, row.live_class_id))


async def reconcile_recordings():
    """Recover response loss, stop failures, missed webhooks, and expired files."""
    provider = get_recording_provider()
    with SessionLocal() as db:
        ids = list(db.scalars(select(ClassRecording.id).where(ClassRecording.status.in_(PENDING))))
        for identifier in ids:
            try:
                row = db.get(ClassRecording, identifier)
                item = db.get(LiveClass, row.live_class_id)
                try:
                    infos = await provider.list(room_name(item.id))
                except Exception:
                    infos = None
                    log.warning('Classroom recording provider reconciliation unavailable')
                matching = next((info for info in infos or [] if row.storage_key in _keys(info)), None)
                await asyncio.to_thread(db.refresh, row, with_for_update=True)
                if matching:
                    apply_info(db, row, matching)
                elif infos is not None and row.status == 'STARTING' and (now() - utc(row.created_at)).total_seconds() > 90:
                    row.status = 'FAILED'; row.error_code = 'START_FAILED'; row.updated_at = now()
                # A terminated Egress handler can leave its cached provider state
                # at ENDING indefinitely. Never expose an incomplete file, and
                # let the host remove a failed segment after a bounded wait.
                if row.status == 'PROCESSING' and row.stopped_at and (now() - utc(row.stopped_at)).total_seconds() > get_settings().RECORDING_PROCESSING_TIMEOUT_SECONDS:
                    row.status = 'FAILED'; row.error_code = 'PROCESSING_TIMEOUT'; row.updated_at = now()
                    audit(db, row, 'RECORDING_FAILED')
                await asyncio.to_thread(db.commit)
                if row.status in ACTIVE and (row.stop_requested_at or item.status != LiveClassStatus.ongoing or utc(row.expires_at) <= now()):
                    await stop(db, row, None, provider)
                await broadcast(db, item)
            except Exception:
                db.rollback(); log.warning('Classroom recording reconciliation pending')
        rows = list(db.scalars(select(ClassRecording).where(
            (ClassRecording.expires_at <= now()) | ClassRecording.delete_pending.is_(True))))
        for row in rows:
            if row.status not in PENDING:
                await asyncio.to_thread(delete, db, row)
        # Class deletion uses its existing database cascades. Reclaim private
        # files whose metadata was removed, with a grace period for finalization.
        storage = get_recording_storage()
        referenced = set(db.scalars(select(ClassRecording.storage_key).where(ClassRecording.status != 'DELETED')))
        for key in storage.old_keys((now() - timedelta(minutes=5)).timestamp()):
            if key not in referenced:
                storage.delete(key)
