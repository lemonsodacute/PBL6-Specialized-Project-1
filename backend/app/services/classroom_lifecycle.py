import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from sqlalchemy import select
from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.entities import LiveClass
from app.services.classroom_provider import get_classroom_provider, room_name

log = logging.getLogger(__name__)


async def retry_closures():
    while True:
        try:
            ids = await asyncio.to_thread(pending_ids)
            for session_id in ids:
                await get_classroom_provider().close_room(room_name(session_id))
                await asyncio.to_thread(mark_closed, session_id)
        except Exception:
            # No credentials, tokens, media or participant data in logs.
            log.warning('Classroom closure retry pending; provider unavailable')
        await asyncio.sleep(5)


def pending_ids():
    with SessionLocal() as db:
        return list(db.scalars(select(LiveClass.id).where(LiveClass.provider_close_pending.is_(True))))


def mark_closed(session_id):
    with SessionLocal() as db:
        row = db.get(LiveClass, session_id)
        if row:
            row.provider_close_pending = False
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
