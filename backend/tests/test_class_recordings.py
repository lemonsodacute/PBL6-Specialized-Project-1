import asyncio
import base64
import hashlib
import tempfile
import os
from datetime import timedelta
from pathlib import Path
from unittest import TestSuite
from unittest.mock import patch
from uuid import UUID, uuid4

from fastapi import HTTPException
from google.protobuf.json_format import MessageToJson
from livekit import api
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_live_classroom import LiveClassroomTests
from app.core.config import Settings, get_settings
from app.models.entities import AuditLog, ClassEnrollment, ClassRecording, LiveClass
from app.services import class_recordings as service
from app.services.recording_provider import get_recording_provider
from app.services.recording_storage import LocalRecordingStorage
from app.main import app


class RecordingProvider:
    def __init__(self):
        self.infos = []; self.stops = []; self.unavailable = False; self.ambiguous = False; self.stop_failed = False

    async def available(self): return not self.unavailable
    async def start(self, room, key):
        info = api.EgressInfo(egress_id=f'EG_{key[:8]}', room_name=room, status=1,
            started_at=int(service.now().timestamp() * 1e9),
            egress=api.StartEgressRequest(room_name=room, template=api.TemplateSource(layout='speaker'),
                outputs=[api.Output(file=api.FileOutput(filepath=f'/out/{key}'))]))
        self.infos.append(info)
        if self.ambiguous: raise HTTPException(503)
        return info
    async def stop(self, identifier):
        self.stops.append(identifier)
        if self.stop_failed: raise HTTPException(503)
        info = next(info for info in self.infos if info.egress_id == identifier)
        info.status = 2
        return info
    async def list(self, room): return [info for info in self.infos if info.room_name == room]


class RecordingTests(LiveClassroomTests):
    def setUp(self):
        super().setUp()
        AuditLog.__table__.create(self.engine)
        temporary = self.enterContext(tempfile.TemporaryDirectory())
        self.storage = LocalRecordingStorage(Path(temporary))
        self.recorder = RecordingProvider()
        settings = get_settings().model_copy(update={'CLASS_RECORDING_ENABLED': True, 'RECORDING_STORAGE_ROOT': Path(temporary)})
        self.enterContext(patch('app.services.class_recordings.get_settings', return_value=settings))
        self.enterContext(patch('app.api.v1.class_recordings.get_settings', return_value=settings))
        self.enterContext(patch('app.services.class_recordings.get_recording_storage', return_value=self.storage))
        self.enterContext(patch('app.api.v1.class_recordings.get_recording_storage', return_value=self.storage))
        self.enterContext(patch('app.services.class_recordings.get_recording_provider', return_value=self.recorder))
        self.enterContext(patch('app.services.class_recordings.get_classroom_provider', return_value=self.provider))
        self.enterContext(patch('app.services.class_recordings.SessionLocal', side_effect=lambda: Session(self.engine)))
        self.enterContext(patch('app.api.v1.class_recordings.SessionLocal', side_effect=lambda: Session(self.engine)))
        self.notices = self.enterContext(patch('app.services.class_recordings.create_notification'))
        app.dependency_overrides[get_recording_provider] = lambda: self.recorder
        self.addCleanup(lambda: app.dependency_overrides.pop(get_recording_provider, None))

    def begin(self):
        self.live()
        response = self.post('recording/start')
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['data']

    def recording(self, identifier=None):
        self.db.expire_all()
        return self.db.get(ClassRecording, UUID(identifier)) if identifier else self.db.scalar(select(ClassRecording).order_by(ClassRecording.created_at.desc()))

    def complete(self):
        row = self.recording()
        # Explicit provider/storage fixture, never application-generated fake media.
        data = b'\x00\x00\x00\x20ftypisom' + b'x' * 1024
        self.storage.path(row.storage_key).write_bytes(data)
        info = self.recorder.infos[-1]
        info.status = 3; info.ended_at = int(service.now().timestamp() * 1e9)
        info.file_results.append(api.FileInfo(filename=f'/out/{row.storage_key}', duration=90_000_000_000, size=len(data)))
        service.apply_info(self.db, row, info); self.db.commit()
        return row

    def rec_post(self, row, action, actor=None):
        return self.client.post(f'/api/v1/recordings/{row.id}/{action}', headers=self.headers(actor))

    def lease(self, row, actor=None):
        return self.client.get(f'/api/v1/recordings/{row.id}/playback', headers=self.headers(actor))

    def test_recording_defaults_off_and_never_starts_with_class(self):
        self.assertFalse(Settings(_env_file=None).CLASS_RECORDING_ENABLED)
        self.live()
        self.client.get(f'/api/v1/live-classes/{self.id}', headers=self.headers())
        self.assertEqual(self.recorder.infos, [])
        self.assertIsNone(self.recording())

    def test_recording_role_ownership_and_class_state_are_enforced(self):
        self.assertEqual(self.post('recording/start', self.student).status_code, 403)
        self.assertEqual(self.post('recording/start', self.other).status_code, 404)
        self.assertEqual(self.post('recording/start').status_code, 409)
        self.live(); self.post('end')
        self.assertEqual(self.post('recording/start').status_code, 409)
        self.assertEqual(self.recorder.infos, [])

    def test_recording_unavailable_is_not_completed_or_fake(self):
        self.live(); self.recorder.unavailable = True
        response = self.post('recording/start')
        self.assertEqual(response.status_code, 503)
        self.assertIsNone(self.recording())

    def test_recording_start_authoritative_separate_state_and_duplicate_guard(self):
        data = self.begin()
        self.assertEqual(data['status'], 'RECORDING')
        self.assertNotIn('storage_key', data); self.assertNotIn('provider_recording_id', data)
        self.assertEqual(self.post('recording/start').status_code, 409)
        self.assertEqual(len(self.recorder.infos), 1)
        detail = self.client.get(f'/api/v1/live-classes/{self.id}', headers=self.headers(self.student)).json()['data']
        self.assertTrue(detail['recording']['active']); self.assertEqual(detail['status'], 'ongoing')
        self.assertEqual(self.provider.events[-1][0], 'classroom-recording')

    def test_recording_stop_is_idempotent_and_processing_has_no_player(self):
        self.begin()
        self.assertEqual(self.post('recording/stop').json()['data']['status'], 'PROCESSING')
        self.assertEqual(self.post('recording/stop').status_code, 200)
        self.assertEqual(len(self.recorder.stops), 1)
        self.assertEqual(self.lease(self.recording()).status_code, 409)

    def test_recording_end_stops_before_room_closure(self):
        self.begin()
        observed = []
        original = self.provider.close_room
        async def close(name):
            observed.append(len(self.recorder.stops)); await original(name)
        self.provider.close_room = close
        self.assertEqual(self.post('end').status_code, 200)
        self.assertEqual(observed, [1]); self.assertEqual(self.recording().status, 'PROCESSING')

    def test_recording_teacher_disconnect_does_not_stop_live_class(self):
        self.begin()
        self.assertEqual(self.post('leave', body={'participant_sid': 'PA_teacher'}).status_code, 200)
        self.assertEqual(self.recording().status, 'RECORDING'); self.assertEqual(self.recorder.stops, [])

    def test_recording_lost_start_response_is_reconciled_without_duplicate(self):
        self.live(); self.recorder.ambiguous = True
        self.assertEqual(self.post('recording/start').json()['data']['status'], 'STARTING')
        self.assertEqual(self.post('recording/start').status_code, 409)
        asyncio.run(service.reconcile_recordings())
        self.assertEqual(self.recording().status, 'RECORDING')

    def test_recording_failed_stop_retains_durable_stop_intent(self):
        self.begin(); self.recorder.stop_failed = True
        self.post('recording/stop')
        row = self.recording(); self.assertIsNotNone(row.stop_requested_at); self.assertEqual(row.error_code, 'STOP_PENDING')
        self.recorder.stop_failed = False
        asyncio.run(service.reconcile_recordings())
        self.assertEqual(self.recording().status, 'PROCESSING')

    def test_recording_ready_requires_provider_complete_and_private_file(self):
        self.begin(); row = self.complete()
        self.assertEqual(row.status, 'READY'); self.assertEqual(row.duration_seconds, 90)
        self.assertEqual(self.notices.call_count, 0)
        self.assertEqual(self.client.get(f'/api/v1/recordings/{row.id}', headers=self.headers(self.student)).status_code, 404)
        self.assertEqual(self.lease(row, self.student).status_code, 404)
        self.assertEqual(self.lease(row).status_code, 200)

    def test_recording_publish_notifies_only_enrolled_students_once(self):
        self.begin(); row = self.complete()
        self.assertEqual(self.rec_post(row, 'publish', self.student).status_code, 403)
        self.assertEqual(self.rec_post(row, 'publish', self.other).status_code, 404)
        self.assertEqual(self.rec_post(row, 'publish').status_code, 200)
        self.assertEqual(self.rec_post(row, 'publish').status_code, 200)
        self.assertEqual(self.notices.call_count, 1)
        self.assertEqual(self.notices.call_args.args[1], self.student.id)
        self.assertEqual(self.lease(row, self.outsider).status_code, 404)
        self.assertEqual(self.lease(row, self.student).status_code, 200)

    def test_recording_ranges_work_and_unpublish_revokes_existing_ticket(self):
        self.begin(); row = self.complete(); self.rec_post(row, 'publish')
        path = '/api/v1' + self.lease(row, self.student).json()['data']['media_path']
        response = self.client.get(path, headers={'Range': 'bytes=0-31'})
        self.assertEqual(response.status_code, 206); self.assertEqual(len(response.content), 32)
        self.assertIn('no-store', response.headers['cache-control'])
        self.assertEqual(self.client.get(path, headers={'Range': 'bytes=100-3'}).status_code, 416)
        self.rec_post(row, 'unpublish')
        self.assertTrue(self.storage.path(row.storage_key).is_file())
        self.assertIn(self.client.get(path).status_code, (401, 404))
        self.assertEqual(self.lease(row, self.student).status_code, 404)

    def test_recording_enrollment_and_active_user_rechecked_for_every_media_request(self):
        self.begin(); row = self.complete(); self.rec_post(row, 'publish')
        path = '/api/v1' + self.lease(row, self.student).json()['data']['media_path']
        self.db.execute(delete(ClassEnrollment).where(ClassEnrollment.student_id == self.student.id)); self.db.commit()
        self.assertEqual(self.client.get(path).status_code, 404)
        self.db.add(ClassEnrollment(id=uuid4(), class_id=self.cls.id, student_id=self.student.id)); self.db.commit()
        self.student.is_active = False; self.db.commit()
        self.assertEqual(self.client.get(path).status_code, 401)

    def test_recording_delete_removes_object_revokes_access_and_audits(self):
        self.begin(); row = self.complete(); self.rec_post(row, 'publish')
        path = '/api/v1' + self.lease(row, self.student).json()['data']['media_path']
        response = self.client.delete(f'/api/v1/recordings/{row.id}', headers=self.headers())
        self.assertEqual(response.status_code, 200); self.assertFalse(self.storage.path(row.storage_key).exists())
        self.assertEqual(self.client.get(path).status_code, 404)
        self.assertEqual(self.client.delete(f'/api/v1/recordings/{row.id}', headers=self.headers()).status_code, 200)
        actions = set(self.db.scalars(select(AuditLog.action)))
        self.assertTrue({'RECORDING_STARTED', 'RECORDING_PUBLISHED', 'RECORDING_DELETED'}.issubset(actions))

    def test_recording_expiration_revokes_before_cleanup_and_removes_file(self):
        self.begin(); row = self.complete(); self.rec_post(row, 'publish')
        row.expires_at = service.now() - timedelta(seconds=1); self.db.commit()
        self.assertEqual(self.lease(row, self.student).status_code, 404)
        asyncio.run(service.reconcile_recordings())
        self.assertEqual(self.recording().status, 'DELETED'); self.assertFalse(self.storage.path(row.storage_key).exists())

    def test_recording_missing_media_cannot_be_published(self):
        self.begin(); row = self.complete(); self.storage.delete(row.storage_key)
        self.assertEqual(self.rec_post(row, 'publish').status_code, 409)
        self.assertEqual(self.notices.call_count, 0)

    def test_recording_changed_media_size_is_rejected_for_publish_and_preview(self):
        self.begin(); row = self.complete()
        path = self.storage.path(row.storage_key)
        path.write_bytes(path.read_bytes() + b'changed')
        self.assertEqual(self.rec_post(row, 'publish').status_code, 409)
        self.assertEqual(self.lease(row).status_code, 404)

    def test_recording_multiple_segments_do_not_overwrite_and_old_events_do_not_regress(self):
        self.begin(); first = self.complete()
        service.apply_info(self.db, first, api.EgressInfo(egress_id=first.provider_recording_id, room_name=f'classroom-{self.id}', status=1))
        self.db.commit(); self.assertEqual(first.status, 'READY')
        second = self.post('recording/start').json()['data']
        self.assertNotEqual(str(first.id), second['id']); self.assertTrue(self.storage.path(first.storage_key).is_file())

    def test_recording_signed_webhook_required_and_provider_failures_never_ready(self):
        self.begin(); info = self.recorder.infos[-1]
        info.status = 4
        body = MessageToJson(api.WebhookEvent(event='egress_ended', egress_info=info))
        response = self.client.post('/api/v1/live-classes/provider-webhook', content=body, headers={'Authorization': 'forged'})
        self.assertEqual(response.status_code, 401); self.assertEqual(self.recording().status, 'RECORDING')
        digest = base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
        signature = api.AccessToken(self.provider.settings.LIVEKIT_API_KEY, self.provider.settings.LIVEKIT_API_SECRET).with_sha256(digest).to_jwt()
        self.assertEqual(self.client.post('/api/v1/live-classes/provider-webhook', content=body, headers={'Authorization': signature}).status_code, 200)
        self.assertEqual(self.recording().status, 'FAILED'); self.assertEqual(self.lease(self.recording()).status_code, 409)

    def test_recording_class_delete_keeps_existing_cascade_and_reclaims_private_orphans(self):
        self.begin(); row = self.complete()
        target = self.storage.path(row.storage_key)
        self.assertEqual(self.client.delete(f'/api/v1/classes/{self.cls.id}', headers=self.headers()).status_code, 200)
        self.assertEqual(self.lease(row, self.student).status_code, 404)
        old = (service.now() - timedelta(minutes=10)).timestamp()
        os.utime(target, (old, old))
        asyncio.run(service.reconcile_recordings())
        self.assertFalse(target.exists())

    def test_recording_failed_stop_still_ends_room_and_marks_processing(self):
        self.begin(); self.recorder.stop_failed = True
        self.assertEqual(self.post('end').status_code, 200)
        row = self.recording()
        self.assertIsNotNone(row.stop_requested_at)
        self.assertEqual(row.status, 'PROCESSING')
        self.assertTrue(self.provider.closed)

    def test_recording_stalled_processing_expires_without_exposing_media(self):
        self.begin(); self.post('recording/stop')
        asyncio.run(service.reconcile_recordings())
        row = self.recording(); self.assertEqual(row.status, 'PROCESSING')
        row.stopped_at = service.now() - timedelta(days=2); self.db.commit()
        asyncio.run(service.reconcile_recordings())
        row = self.recording()
        self.assertEqual(row.status, 'FAILED'); self.assertEqual(row.error_code, 'PROCESSING_TIMEOUT')
        self.assertEqual(self.lease(row).status_code, 409)
        self.assertEqual(self.rec_post(row, 'publish').status_code, 409)
        # A late result cannot silently resurrect a failed segment.
        self.assertEqual(self.complete().status, 'FAILED')
        asyncio.run(service.reconcile_recordings())
        failures = list(self.db.scalars(select(AuditLog).where(AuditLog.entity_id == row.id, AuditLog.action == 'RECORDING_FAILED')))
        self.assertEqual(len(failures), 1)
        self.assertEqual(self.client.delete(f'/api/v1/recordings/{row.id}', headers=self.headers()).status_code, 200)

    def test_recording_processing_timeout_survives_provider_outage(self):
        self.begin(); self.post('recording/stop')
        row = self.recording(); row.stopped_at = service.now() - timedelta(days=2); self.db.commit()
        async def unavailable(_room): raise HTTPException(503)
        with patch.object(self.recorder, 'list', side_effect=unavailable):
            asyncio.run(service.reconcile_recordings())
        self.assertEqual(self.recording().error_code, 'PROCESSING_TIMEOUT')
        self.assertEqual(self.recording().status, 'FAILED')
        self.assertEqual(self.lease(self.recording(), self.student).status_code, 404)


def load_tests(_loader, _tests, _pattern):
    # The existing classroom suite runs separately; only new cases belong here.
    return TestSuite(RecordingTests(name) for name in dir(RecordingTests) if name.startswith('test_recording_'))
