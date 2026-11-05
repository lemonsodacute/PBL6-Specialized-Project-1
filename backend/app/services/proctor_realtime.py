"""Committed identifier invalidations on existing WebSocket/PG NOTIFY infrastructure."""
import asyncio
import json
import logging
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from uuid import UUID
from fastapi import WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool
from sqlalchemy import text, select
from app.core.config import settings
from app.core.database import engine
from app.core.security import decode_access_token
from app.models.entities import User, UserRole
from app.services.monitoring import ConnectionManager, manager as legacy_manager
from app.services.proctor_events import exam_access, recipients
from app.proctoring.diagnostics import diagnostic

manager = ConnectionManager()
scopes: dict[WebSocket, UUID | None] = {}
CHANNEL = 'proctor_alert_changes'
logger = logging.getLogger(__name__)


def change(db, row, kind):
    from app.models.entities import Exam, ExamAttempt
    attempt = db.get(ExamAttempt, row.attempt_id)
    exam = db.get(Exam, attempt.exam_id)
    event = {'type':kind, 'data':{'id':str(row.id),'exam_id':str(exam.id),
        'attempt_id':str(row.attempt_id),'is_simulated':row.is_simulated},
        'recipients':[str(value) for value in recipients(db, exam)]}
    enqueue(db, event)
    return event


def enqueue(db, event):
    if db.bind.dialect.name == 'postgresql':
        for offset in range(0, len(event['recipients']), 90):
            chunk = {**event,'recipients':event['recipients'][offset:offset+90]}
            db.execute(text('SELECT pg_notify(:channel, :payload)'), {'channel':CHANNEL,'payload':json.dumps(chunk)})


def health_change(db,provider,exam=None):
    people=recipients(db,exam) if exam else db.scalars(select(User.id).where(User.is_active.is_(True),User.role.in_([UserRole.teacher,UserRole.admin]))).all()
    event={'type':'proctor_module_health','data':{'provider':provider,**({'exam_id':str(exam.id)} if exam else {})},'recipients':[str(value) for value in people]}
    enqueue(db,event);return event


async def deliver(event):
    public = {key:value for key,value in event.items() if key != 'recipients'}
    exam_id = event.get('data', {}).get('exam_id')
    async with manager._lock:
        targets = [(UUID(recipient), socket) for recipient in event['recipients']
            for socket in manager._connections.get(UUID(recipient), set())
            if scopes.get(socket) is None or str(scopes.get(socket)) == exam_id]
    async def send(user_id, socket):
        try:
            await asyncio.wait_for(socket.send_json(public), timeout=3)
            return True
        except Exception:
            scopes.pop(socket, None)
            await manager.disconnect(user_id, socket)
            return False
    delivered=await asyncio.gather(*(send(*target) for target in targets))
    diagnostic('websocket_delivery', message_type=event['type'], targets=len(targets), delivered=sum(delivered))


async def after_commit(db, event):
    if event and db.bind.dialect.name != 'postgresql':
        await deliver(event)


async def socket(websocket: WebSocket, db, exam_id: UUID | None = None):
    origin = websocket.headers.get('origin')
    if origin and origin not in settings.CORS_ORIGINS:
        await websocket.close(code=1008); return
    await websocket.accept()
    user_id = None
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=5)
        if len(raw) > 4096: raise ValueError('Oversized authentication frame')
        auth = json.loads(raw)
        if not isinstance(auth,dict) or auth.get('type') != 'auth': raise ValueError('Authentication required')
        token = auth.get('token') if auth.get('token') is not None else websocket.cookies.get('auth_token')
        payload = decode_access_token(token)
        user_id = UUID(payload['sub'])
        def authorize():
            if payload['exp'] <= datetime.now(timezone.utc).timestamp(): raise ValueError('Expired authentication')
            db.expire_all()
            user = db.get(User,user_id)
            if not user or not user.is_active or user.role not in (UserRole.teacher,UserRole.admin):
                raise ValueError('Forbidden monitoring subscription')
            if exam_id: exam_access(db,exam_id,user)
            db.rollback()
        await run_in_threadpool(authorize)
        scopes[websocket] = exam_id
        await manager.connect(user_id,websocket)
        # Keep legacy browser/attempt status invalidations on the existing exam channel.
        if exam_id: await legacy_manager.connect(exam_id,websocket)
        await websocket.send_json({'type':'ready'})
        while True:
            try:
                frame = await asyncio.wait_for(websocket.receive_text(), timeout=25)
                if frame not in {'ping','pong'}: raise ValueError('Unsupported frame')
                if frame=='pong':
                    await run_in_threadpool(authorize)
                    continue
            except asyncio.TimeoutError:
                pass
            await run_in_threadpool(authorize)
            await websocket.send_json({'type':'ping'})
    except WebSocketDisconnect:
        pass
    except Exception:
        with suppress(RuntimeError): await websocket.close(code=1008)
    finally:
        scopes.pop(websocket,None)
        if user_id: await manager.disconnect(user_id,websocket)
        if exam_id: await legacy_manager.disconnect(exam_id,websocket)


async def listen():
    while True:
        connection = None
        try:
            connection = await asyncio.to_thread(engine.raw_connection)
            driver = connection.driver_connection
            with driver.cursor() as cursor: cursor.execute(f'LISTEN {CHANNEL}')
            driver.commit()
            # A listener outage can lose NOTIFY packets, never persisted events.
            for user_id in list(manager._connections):
                await manager.broadcast(user_id, {'type':'resync'})
            while True:
                await asyncio.sleep(.2)
                driver.poll()
                while driver.notifies: await deliver(json.loads(driver.notifies.pop(0).payload))
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning('proctor_realtime_reconnecting')
            await asyncio.sleep(2)
        finally:
            if connection is not None:
                connection.invalidate(); connection.close()


@asynccontextmanager
async def proctor_lifespan(_app):
    task = asyncio.create_task(listen()) if engine.dialect.name == 'postgresql' else None
    from app.proctoring.adapters import runtime
    from app.proctoring.adapters import configured_models
    diagnostic('startup', model_enabled=settings.PROCTOR_MODEL_ENABLED,
        providers=[{'provider':provider,'interval_ms':profile.frame_interval_ms,'event_types':list(profile.policies)}
            for provider,profile,_ in configured_models()])
    async def cleanup():
        while True:
            await asyncio.sleep(30)
            await runtime.cleanup()
    cleanup_task=asyncio.create_task(cleanup())
    try:
        yield
    finally:
        cleanup_task.cancel()
        with suppress(asyncio.CancelledError): await cleanup_task
        await runtime.close()
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError): await task
