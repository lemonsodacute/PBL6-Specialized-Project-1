import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from sqlalchemy import select
from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.entities import LiveClass, LiveClassStatus
from app.services.classroom_controls import project
from app.services.classroom_provider import get_classroom_provider, room_name
from app.services.class_recordings import reconcile_recordings, stop_for_class, room_closed

log = logging.getLogger(__name__)


async def retry_closures():
    while True:
        try:
            ids = await asyncio.to_thread(pending_ids)
            for session_id in ids:
                with SessionLocal() as db:
                    await stop_for_class(db, session_id)
                await get_classroom_provider().close_room(room_name(session_id))
                await asyncio.to_thread(mark_closed, session_id)
            await retry_controls()
            await reconcile_recordings()
        except Exception:
            # No credentials, tokens, media or participant data in logs.
            log.warning('Classroom closure retry pending; provider unavailable')
        await asyncio.sleep(5)


def pending_ids():
    with SessionLocal() as db:
        return list(db.scalars(select(LiveClass.id).where(LiveClass.provider_close_pending.is_(True))))


async def retry_controls():
    # Reuse the durable lifecycle worker. Row locks serialize concurrent host edits.
    with SessionLocal() as db:
        ids = await asyncio.to_thread(lambda: list(db.scalars(select(LiveClass.id).where(LiveClass.controls_sync_pending.is_(True), LiveClass.status == LiveClassStatus.ongoing))))
        for session_id in ids:
            item = await asyncio.to_thread(lambda: db.scalar(select(LiveClass).where(LiveClass.id == session_id).with_for_update(skip_locked=True)))
            if item is None:
                db.rollback()
                continue
            await project(get_classroom_provider(), item)
            item.controls_sync_pending = False
            db.commit()


def mark_closed(session_id):
    with SessionLocal() as db:
        # A webhook/join can still hold the session lock. Never let the retry
        # worker wait indefinitely behind an abandoned or slow request.
        row = db.scalar(select(LiveClass).where(LiveClass.id == session_id).with_for_update(skip_locked=True))
        if row:
            row.provider_close_pending = False
            room_closed(db, session_id)
            db.commit()


@asynccontextmanager
async def classroom_lifespan(_application):
    task = asyncio.create_task(retry_closures()) if get_settings().LIVEKIT_URL else None
    try:
        yield
    finally:
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
