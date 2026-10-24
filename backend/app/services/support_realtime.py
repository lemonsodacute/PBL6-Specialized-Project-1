"""User-scoped sockets; PostgreSQL NOTIFY fans out committed changes across workers.

Events carry identifiers only. REST remains the permission-checked source of truth.
The existing ConnectionManager handles connection cleanup and JSON serialization.
"""
import asyncio
import json
import logging
from contextlib import asynccontextmanager, suppress
from uuid import UUID
from sqlalchemy import text
from app.core.database import engine
from app.services.monitoring import ConnectionManager

manager = ConnectionManager()
logger = logging.getLogger(__name__)
CHANNEL = 'support_chat_changes'


async def deliver(event):
    public = {key: value for key, value in event.items() if key != 'recipients'}
    await asyncio.gather(*(manager.broadcast(UUID(recipient), public) for recipient in event['recipients']))


def enqueue(db, event):
    if db.bind.dialect.name == 'postgresql':
        # NOTIFY is delivered only after the surrounding transaction commits.
        # Keep each payload below PostgreSQL's 8 KB NOTIFY limit even with many admins.
        for offset in range(0, len(event['recipients']), 100):
            chunk = {**event, 'recipients': event['recipients'][offset:offset + 100]}
            db.execute(text('SELECT pg_notify(:channel, :payload)'), {'channel': CHANNEL, 'payload': json.dumps(chunk)})


async def after_commit(db, event):
    if db.bind.dialect.name != 'postgresql':
        await deliver(event)


async def listen():
    while True:
        connection = None
        try:
            connection = await asyncio.to_thread(engine.raw_connection)
            driver = connection.driver_connection
            with driver.cursor() as cursor:
                cursor.execute(f'LISTEN {CHANNEL}')
            driver.commit()
            # Existing clients resync if the listener had to reconnect.
            for user_id in list(manager._connections):
                await manager.broadcast(user_id, {'type': 'resync'})
            while True:
                await asyncio.sleep(0.2)
                driver.poll()
                while driver.notifies:
                    event = json.loads(driver.notifies.pop(0).payload)
                    await deliver(event)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning('Support realtime listener reconnecting', exc_info=False)
            await asyncio.sleep(2)
        finally:
            if connection is not None:
                connection.invalidate()  # Never return a LISTEN connection to the pool.
                connection.close()


@asynccontextmanager
async def support_lifespan(_app):
    task = asyncio.create_task(listen()) if engine.dialect.name == 'postgresql' else None
    try:
        yield
    finally:
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
