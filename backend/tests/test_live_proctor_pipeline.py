"""HTTP regression tests with explicit synthetic worker observations, never webcam proof."""
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from io import BytesIO
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

import httpx
from PIL import Image
from sqlalchemy import select

from app.core.config import settings
from app.core.security import create_access_token
from app.main import app
from app.models.entities import DetectionEvent, Notification, ProctorEventReceipt, ProctorModelHealth, SupportConversation, UserSettings
from app.proctoring.adapters import AdapterRuntime
from app.proctoring.local_policy import local_models
from proctor_worker import main as worker
from proctor_worker.protocol import Detection, Gaze, Objects
from tests import test_teacher_results as fixtures


@asynccontextmanager
async def isolated_lifespan(_app):
    # No retention jobs, model warmup or external services in HTTP regression tests.
    yield


class LiveProctorPipelineTests(TestCase):
    def setUp(self):
        self.enterContext(patch.object(app.router, 'lifespan_context', isolated_lifespan))
        self.fixture = fixtures.TeacherResultsTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.db, self.client = self.fixture.db, self.fixture.client
        for model in (ProctorEventReceipt, ProctorModelHealth, SupportConversation, Notification, UserSettings):
            model.__table__.create(self.db.bind)
        self.fixture.exam.require_camera = True
        self.db.commit()
        self.enterContext(patch.object(settings, 'PROCTOR_MODEL_ENABLED', True))
        self.enterContext(patch.object(settings, 'PROCTOR_MODELS', local_models()))
        self.enterContext(patch.object(settings, 'PROCTOR_GAZE_CALIBRATION', False))
        self.enterContext(patch.object(settings, 'ENVIRONMENT', 'test'))
        self.runtime = AdapterRuntime()
        self.enterContext(patch('app.api.v1.proctor_alerts.runtime', self.runtime))
        self.base = f'/api/v1/proctoring/sessions/{self.fixture.progress.id}'
        self.headers = self.fixture.headers(self.fixture.active)
        image = BytesIO()
        Image.new('RGB', (8, 8)).save(image, format='JPEG')
        self.image = image.getvalue()
        self.stamp = datetime.now(timezone.utc)
        owner = self

        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return owner.stamp

        self.enterContext(patch('app.api.v1.proctor_alerts.datetime', Clock))

    def capabilities(self):
        return self.client.get(self.base + '/input-capabilities', headers=self.headers)

    def start(self):
        self.assertEqual(self.client.post(self.base, headers=self.headers).status_code, 200)

    def frame(self, milliseconds=0):
        original = self.stamp
        self.stamp = self.start_time + timedelta(milliseconds=milliseconds)
        try:
            return self.client.post(self.base + '/frame', headers=self.headers,
                files={'frame': ('camera.jpg', self.image, 'image/jpeg')})
        finally:
            self.stamp = original

    def install_worker(self, *, phone=True, face=False):
        """Real /infer route and auth, with test-only model results and ASGI transport."""
        self.start_time = self.stamp
        self.mode = 'ok'
        self.requests = []
        self.phone, self.face = phone, face
        self.phone_confidence = .81
        owner = self

        class Detector:
            async def detect(self, data):
                return Objects(status='OK', detections=[Detection(class_id=2, class_name='cell phone',
                    confidence=owner.phone_confidence, bbox=(.1, .2, .8, .9))] if owner.phone else [])

        def gaze(_tracker, _data):
            return Gaze(status='OK', face_detected=owner.face, raw_status='QUAY_SANG_TRAI' if owner.face else 'KHONG_THAY_MAT',
                **({'yaw': -30, 'pitch': 0, 'roll': 0, 'gaze_ratio': .5} if owner.face else {}))

        credential = 'test-only-worker-credential-' + uuid4().hex
        self.enterContext(patch.object(worker.app.state, 'key', credential, create=True))
        self.enterContext(patch.object(worker.app.state, 'busy', False, create=True))
        self.enterContext(patch.object(worker.app.state, 'yolo', Detector(), create=True))
        self.enterContext(patch.object(worker.app.state, 'gaze', object(), create=True))
        self.enterContext(patch.object(worker, 'gaze_infer', gaze))
        self.enterContext(patch('app.proctoring.local_worker.KEY_FILE')).read_text.return_value = credential
        asgi = httpx.ASGITransport(app=worker.app)

        async def transport(request):
            self.requests.append(request)
            if self.mode == 'timeout':
                raise httpx.ReadTimeout('Test-only failure', request=request)
            if self.mode == 'unavailable':
                return httpx.Response(200, json={request.url.params['module']: {'status': 'UNAVAILABLE'}, 'timings_ms': {}})
            if self.mode == 'invalid':
                return httpx.Response(200, json={'invalid': True})
            if self.mode == 'http_error':
                return httpx.Response(500)
            if self.mode == 'unauthorized':
                request.headers['X-Proctor-Worker-Key'] = 'invalid-test-key'
            return await asgi.handle_async_request(request)

        client = httpx.AsyncClient
        def connect(**kwargs):
            return client(**kwargs, transport=httpx.MockTransport(transport))
        self.enterContext(patch('app.proctoring.local_worker.httpx.AsyncClient', connect))
        self.addCleanup(lambda: self.client.delete(self.base + '/input', headers=self.headers))

    def test_capabilities_enable_both_profiles_without_direction_calibration(self):
        response = self.capabilities()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['data'], {'enabled': True, 'frame_interval_ms': 100, 'gaze_calibration_enabled': False})
        for flag in ('PROCTOR_MODEL_ENABLED',):
            with patch.object(settings, flag, False):
                data = self.capabilities().json()['data']
                self.assertFalse(data['enabled'])
                self.assertIsNone(data['frame_interval_ms'])

    def test_frames_reach_protected_worker_persist_both_alerts_and_notify_teacher(self):
        self.install_worker()
        self.start()
        with self.client.websocket_connect('/api/v1/proctoring/ws') as socket:
            socket.send_json({'type': 'auth', 'token': create_access_token(str(self.fixture.teacher.id), 'teacher')})
            self.assertEqual(socket.receive_json()['type'], 'ready')
            for tick in range(0, 2401, 100):
                response = self.frame(tick)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['data'], {'processed': True})
                if tick < 600:
                    self.assertEqual(len(self.db.scalars(select(DetectionEvent)).all()), 0)
                elif tick < 2000:
                    self.assertEqual({row.event_type for row in self.db.scalars(select(DetectionEvent))}, {'object_phone'})
            socket.send_text('ping')
            messages = []
            while True:
                message = socket.receive_json()
                if message['type'] == 'ping':
                    break
                messages.append(message)
        rows = self.db.scalars(select(DetectionEvent)).all()
        self.assertEqual({row.event_type for row in rows}, {'object_phone', 'face_not_detected'})
        self.assertEqual({row.event_type: row.severity.value for row in rows}, {'object_phone': 'high', 'face_not_detected': 'low'})
        self.assertEqual(len(rows), 2)  # Sustained observations stay inside cooldown.
        self.assertTrue(all(not row.is_simulated for row in rows))
        self.assertEqual({message['data']['id'] for message in messages if message['type'] == 'proctor_event_created'}, {str(row.id) for row in rows})
        # High-confidence phones are HIGH; low absence signals still reach the feed.
        self.assertEqual(len(self.db.scalars(select(Notification)).all()), 2)
        self.assertEqual({r.url.params['module'] for r in self.requests}, {'object_detection', 'gaze'})
        self.assertTrue(all(r.url.host == '127.0.0.1' and r.url.port == 8765 for r in self.requests))
        self.assertTrue(all(r.content == self.image for r in self.requests))
        warnings = self.client.get(self.base + '/warnings', headers=self.headers).json()['data']
        self.assertEqual({item['id'] for item in warnings}, {str(row.id) for row in rows})
        self.assertEqual({item['event_type'] for item in warnings}, {'object_phone', 'face_not_detected'})
        self.assertTrue(all(set(item) == {'id', 'event_type', 'occurred_at', 'occurrence_count'} for item in warnings))

    def test_low_confidence_phone_stays_medium_and_later_high_updates_same_record(self):
        self.install_worker()
        self.phone_confidence = .31
        # Shorten only this fixture's cooldown, not the shipping policy.
        self.start()
        original = settings.PROCTOR_MODELS['local_yolo']['policies']['object_phone']['cooldown_ms']
        settings.PROCTOR_MODELS['local_yolo']['policies']['object_phone']['cooldown_ms'] = 1000
        try:
            for tick in range(0, 701, 100):
                self.assertEqual(self.frame(tick).status_code, 200)
            phone = self.db.scalar(select(DetectionEvent).where(DetectionEvent.event_type == 'object_phone'))
            self.assertIsNotNone(phone)
            self.assertEqual(phone.severity.value, 'medium')
            original_id = phone.id
            self.phone_confidence = .88
            for tick in range(800, 2001, 100):
                self.assertEqual(self.frame(tick).status_code, 200)
            phone = self.db.scalar(select(DetectionEvent).where(DetectionEvent.event_type == 'object_phone'))
            self.assertEqual(phone.id, original_id)
            self.assertEqual(phone.severity.value, 'high')
            self.assertEqual(self.db.scalar(select(Notification).where(
                Notification.related_proctor_event_id == original_id)).severity, 'high')
        finally:
            settings.PROCTOR_MODELS['local_yolo']['policies']['object_phone']['cooldown_ms'] = original

    def test_student_warnings_are_owner_only_and_exclude_dismissed_simulated_and_browser_events(self):
        self.install_worker()
        self.start()
        for tick in range(0, 2401, 100):
            self.frame(tick)
        path = self.base + '/warnings'
        self.assertEqual(self.client.get(path).status_code, 401)
        for actor in (self.fixture.teacher, self.fixture.student):
            self.assertEqual(self.client.get(path, headers=self.fixture.headers(actor)).status_code, 403)
        rows = self.db.scalars(select(DetectionEvent)).all()
        self.assertEqual(len(rows), 2)
        rows[0].status = 'DISMISSED'
        rows[1].is_simulated = True
        self.db.commit()
        self.assertEqual(self.client.get(path, headers=self.headers).json()['data'], [])
        rows[0].status = 'NEW'
        rows[0].provider = 'browser_signals'
        self.db.commit()
        self.assertEqual(self.client.get(path, headers=self.headers).json()['data'], [])
        from app.models.entities import AttemptStatus
        self.fixture.progress.status = AttemptStatus.submitted
        self.db.commit()
        self.assertEqual(self.client.get(path, headers=self.headers).status_code, 409)

    def test_missing_camera_session_is_recoverable_and_frame_auth_is_required(self):
        self.install_worker(phone=False, face=True)
        response = self.frame()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error']['code'], 'CAMERA_SESSION_REQUIRED')
        self.assertFalse(self.requests)
        self.start()
        self.assertEqual(self.frame().json()['data'], {'processed': True})
        self.assertEqual(self.client.post(self.base + '/frame', files={'frame': ('camera.jpg', self.image, 'image/jpeg')}).status_code, 401)
        self.assertEqual(self.client.post(self.base + '/frame', headers=self.fixture.headers(), files={'frame': ('camera.jpg', self.image, 'image/jpeg')}).status_code, 403)

    def test_worker_failures_acknowledge_unavailable_and_never_create_alerts(self):
        self.install_worker()
        self.start()
        for mode in ('timeout', 'unavailable', 'invalid', 'http_error', 'unauthorized'):
            with self.subTest(mode=mode):
                self.mode = mode
                response = self.frame()
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['data'], {'processed': False})
                self.assertFalse(self.db.scalars(select(DetectionEvent)).all())
                self.assertFalse(self.runtime.sessions)
        self.mode = 'ok'
        self.assertTrue(self.frame().json()['data']['processed'])

    def test_failure_breaks_absence_continuity_and_sustained_direction_becomes_high(self):
        self.install_worker(phone=False)
        self.start()
        for tick in (0, 500, 1000):
            self.assertTrue(self.frame(tick).json()['data']['processed'])
        self.mode = 'unavailable'
        self.assertFalse(self.frame(1500).json()['data']['processed'])
        self.mode = 'ok'
        for tick in (2000, 2500, 3000, 3500):
            self.assertTrue(self.frame(tick).json()['data']['processed'])
            self.assertFalse(self.db.scalars(select(DetectionEvent)).all())
        self.frame(4000)
        self.assertEqual([row.event_type for row in self.db.scalars(select(DetectionEvent))], ['face_not_detected'])
        self.face = True
        for tick in range(4500, 8001, 500):
            self.frame(tick)
        self.assertEqual({row.event_type: row.severity.value for row in self.db.scalars(select(DetectionEvent))},
                         {'face_not_detected': 'low', 'head_turned': 'high'})

    def test_opt_in_diagnostics_contain_only_ephemeral_trace_and_safe_measurements(self):
        import json
        self.install_worker(phone=False, face=True)
        self.start()
        with patch.object(settings, 'PROCTOR_DIAGNOSTICS', False), self.assertNoLogs('proctor.pipeline', level='INFO'):
            self.capabilities()
            self.assertTrue(self.frame().json()['data']['processed'])
        with patch.object(settings, 'PROCTOR_DIAGNOSTICS', True), self.assertLogs('proctor.pipeline', level='INFO') as captured:
            self.assertTrue(self.capabilities().json()['data']['diagnostics_enabled'])
            self.assertTrue(self.frame(300).json()['data']['processed'])
        entries = [json.loads(line.split('proctor_pipeline ', 1)[1]) for line in captured.output]
        self.assertTrue({'capabilities', 'frame_received', 'worker_request', 'worker_response', 'worker_observation', 'temporal_policy', 'frame_committed', 'frame_ack'} <= {entry['stage'] for entry in entries})
        text = '\n'.join(captured.output)
        for private in (str(self.fixture.active.id), str(self.fixture.progress.id), self.fixture.active.email,
                        self.headers['Authorization'], self.image.hex()):
            self.assertNotIn(private, text)
        traces = {entry['trace'] for entry in entries if entry.get('trace')}
        self.assertEqual(len(traces), 1)
        self.assertTrue(all(request.headers.get('X-Proctor-Trace') in traces for request in self.requests[-2:]))
