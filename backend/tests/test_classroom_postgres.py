"""Opt-in regression check against the isolated classroom QA PostgreSQL DB."""
import json
import os
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import TestCase, skipUnless
from uuid import UUID, uuid4
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session
from app.core.database import SessionLocal, engine
from app.models.entities import AuditLog, ClassRecording, LiveClass, LiveClassStatus, User
from app.services.classroom_lifecycle import mark_closed


@skipUnless(os.environ.get('CLASSROOM_POSTGRES_E2E') == '1', 'Requires the isolated PostgreSQL QA runtime and private fixture')
class ClassroomPostgresTests(TestCase):
    def test_recording_webhook_row_lock_does_not_block_the_event_loop(self):
        from livekit import api
        from unittest.mock import AsyncMock
        from app.services import class_recordings as service
        from app.services.classroom_provider import room_name
        self.assertTrue(engine.url.database.startswith('ai_procto_release_qa_'))
        fixture = json.loads(Path(os.environ['CLASSROOM_FIXTURE_PATH']).read_text('utf-8'))
        ClassRecording.__table__.create(engine, checkfirst=True)
        AuditLog.__table__.create(engine, checkfirst=True)
        session_id, recording_id, now = uuid4(), uuid4(), datetime.now(timezone.utc)
        key = f'{recording_id}.mp4'
        with SessionLocal() as db:
            db.add(LiveClass(id=session_id, class_id=UUID(fixture['class_id']), teacher_id=UUID(fixture['teacher']['user']['id']),
                title='Recording row-lock regression', scheduled_start=now, scheduled_end=now + timedelta(hours=1),
                status=LiveClassStatus.ongoing, actual_start=now))
            db.flush()
            db.add(ClassRecording(id=recording_id, live_class_id=session_id, started_by=UUID(fixture['teacher']['user']['id']),
                provider_recording_id=f'EG_{recording_id.hex}', storage_key=key, status='RECORDING',
                started_at=now, expires_at=now + timedelta(days=1), access_version=1, delete_pending=False))
            db.commit()
        try:
            with engine.connect() as connection, Session(bind=connection, expire_on_commit=False) as db, SessionLocal() as owner:
                connection.execute(text("SET statement_timeout = '1500ms'")); connection.commit()
                owner.scalar(select(ClassRecording).where(ClassRecording.id == recording_id).with_for_update())
                info = api.EgressInfo(egress_id=f'EG_{recording_id.hex}', room_name=room_name(session_id), status=2,
                    file_results=[api.FileInfo(filename=f'/out/{key}')])
                async def exercise():
                    async def release():
                        await asyncio.sleep(.05)
                        await asyncio.to_thread(owner.rollback)
                    task = asyncio.create_task(release())
                    try:
                        with patch.object(service, 'broadcast', new=AsyncMock()):
                            await service.handle_webhook(db, info)
                        self.assertEqual(db.get(ClassRecording, recording_id).status, 'PROCESSING')
                    finally:
                        await task
                try:
                    asyncio.run(exercise())
                finally:
                    db.rollback()
                    connection.execute(text('SET statement_timeout = 0')); connection.commit()
        finally:
            with SessionLocal() as db:
                db.execute(delete(AuditLog).where(AuditLog.entity_id == recording_id))
                db.execute(delete(LiveClass).where(LiveClass.id == session_id)); db.commit()

    def test_end_does_not_block_the_loop_behind_a_leave_webhook(self):
        from app.api.v1.live_classes import end_live_class
        self.assertTrue(engine.url.database.startswith('ai_procto_release_qa_'))
        fixture = json.loads(Path(os.environ['CLASSROOM_FIXTURE_PATH']).read_text('utf-8'))
        session_id, now = uuid4(), datetime.now(timezone.utc)
        with SessionLocal() as db:
            db.add(LiveClass(id=session_id, class_id=UUID(fixture['class_id']), teacher_id=UUID(fixture['teacher']['user']['id']),
                title='Classroom end webhook regression', scheduled_start=now, scheduled_end=now + timedelta(hours=1),
                status=LiveClassStatus.ongoing, actual_start=now))
            db.commit()
        try:
            with engine.connect() as connection, Session(bind=connection, expire_on_commit=False) as db, SessionLocal() as webhook:
                # Bound the old deadlock so a regression fails instead of hanging
                # the test. This setting is reset before returning the connection.
                connection.execute(text("SET statement_timeout = '1500ms'")); connection.commit()
                release_task = None
                async def close_room(_name):
                    nonlocal release_task
                    webhook.scalar(select(LiveClass).where(LiveClass.id == session_id).with_for_update())
                    async def release_webhook():
                        await asyncio.sleep(.05)
                        await asyncio.to_thread(webhook.rollback)
                    release_task = asyncio.create_task(release_webhook())
                async def exercise():
                    teacher = db.get(User, UUID(fixture['teacher']['user']['id']))
                    try:
                        with patch('app.api.v1.live_classes.get_classroom_provider', return_value=SimpleNamespace(close_room=close_room)):
                            result = await end_live_class(session_id, db=db, user=teacher)
                        self.assertEqual(result['data']['status'], LiveClassStatus.ended)
                        self.assertFalse(result['data']['provider_close_pending'])
                    finally:
                        if release_task:
                            await release_task
                try:
                    asyncio.run(exercise())
                finally:
                    db.rollback()
                    connection.execute(text('SET statement_timeout = 0')); connection.commit()
        finally:
            with SessionLocal() as db:
                db.execute(delete(LiveClass).where(LiveClass.id == session_id)); db.commit()

    def test_close_retry_skips_a_busy_room_then_finishes_after_unlock(self):
        self.assertTrue(engine.url.database.startswith('ai_procto_release_qa_'))
        fixture = json.loads(Path(os.environ['CLASSROOM_FIXTURE_PATH']).read_text('utf-8'))
        session_id = uuid4()
        now = datetime.now(timezone.utc)
        with SessionLocal() as db:
            db.add(LiveClass(id=session_id, class_id=UUID(fixture['class_id']), teacher_id=UUID(fixture['teacher']['user']['id']),
                title='Classroom closure lock regression', scheduled_start=now, scheduled_end=now + timedelta(hours=1),
                status=LiveClassStatus.ended, provider_close_pending=True))
            db.commit()
        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                with SessionLocal() as owner:
                    owner.scalar(select(LiveClass).where(LiveClass.id == session_id).with_for_update())
                    future = pool.submit(mark_closed, session_id)
                    try:
                        future.result(timeout=3)
                        with SessionLocal() as observer:
                            self.assertTrue(observer.get(LiveClass, session_id).provider_close_pending)
                    finally:
                        owner.rollback()
                future.result(timeout=3)
            mark_closed(session_id)
            with SessionLocal() as db:
                self.assertFalse(db.get(LiveClass, session_id).provider_close_pending)
        finally:
            with SessionLocal() as db:
                db.execute(delete(LiveClass).where(LiveClass.id == session_id))
                db.commit()
