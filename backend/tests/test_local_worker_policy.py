from datetime import datetime, timedelta, timezone
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, patch
import json
import httpx
from uuid import uuid4
from types import SimpleNamespace
from fastapi import HTTPException
from app.models.entities import SeverityLevel
from app.services.proctor_events import policy_for
from app.core.config import settings
from app.proctoring.adapters import AdapterContext, MonitoringFrame, RawPrediction, TemporalPolicy
from app.proctoring.contracts import ModelConfig
from app.proctoring.local_policy import local_models
from app.proctoring.local_worker import LocalWorkerAdapter
from proctor_worker.protocol import Gaze


class LocalPolicyTests(TestCase):
    def test_phone_requires_continuity_and_cooldown(self):
        config = ModelConfig.model_validate(local_models()['local_yolo'])
        state = TemporalPolicy()
        context = AdapterContext(uuid4(), uuid4(), uuid4())
        start = datetime.now(timezone.utc)
        def sample(ms, present):
            stamp = start + timedelta(milliseconds=ms)
            observations = [RawPrediction(label='cell phone', confidence=.6, occurred_at=stamp)] if present else []
            return state.normalize(context, 'local_yolo', config, observations)
        self.assertFalse(sample(0, True))
        self.assertFalse(sample(250, False))
        self.assertFalse(sample(500, True))
        self.assertFalse(sample(750, True))
        alert = sample(1000, True)[0]
        self.assertEqual(alert.event_type, 'object_phone')
        self.assertEqual(alert.severity, SeverityLevel.high)
        self.assertFalse(sample(1250, True))
        self.assertFalse(sample(2500, True))

    def test_absence_and_direction_duration_are_per_attempt(self):
        config = ModelConfig.model_validate(local_models()['local_gaze'])
        adapter = LocalWorkerAdapter('gaze')
        context = AdapterContext(uuid4(), uuid4(), uuid4())
        start = datetime.now(timezone.utc)
        missing = Gaze(status='OK', face_detected=False, raw_status='KHONG_THAY_MAT')
        glance = Gaze(status='OK', face_detected=True, yaw=0, pitch=0, roll=0, gaze_ratio=.7, raw_status='LIEC_SANG_TRAI')
        neutral = glance.model_copy(update={'gaze_ratio':.5, 'raw_status':'BINH_THUONG'})
        def observe(policy, reading, tick):
            stamp = start+timedelta(milliseconds=tick*100)
            predictions = adapter.gaze_predictions(reading, stamp)
            return policy.normalize(context, 'local_gaze', config, predictions)
        policy = TemporalPolicy()
        gaze_alerts = []
        for tick in range(30):
            gaze_alerts.extend(observe(policy, glance, tick))
        self.assertEqual([(alert.event_type, alert.severity) for alert in gaze_alerts],
                         [('gaze_away', SeverityLevel.high)])
        for tick in range(30, 50):
            self.assertFalse(observe(policy, missing, tick))
        self.assertEqual(observe(policy, missing, 50)[0].event_type, 'face_not_detected')
        self.assertFalse(observe(policy, neutral, 51))
        self.assertFalse(observe(policy, missing, 52))
        self.assertFalse(observe(policy, neutral, 53))
        # The shipping profile now includes the worker's direction labels.
        policy = TemporalPolicy()
        self.assertFalse(observe(policy, glance, 80))
        self.assertFalse(observe(policy, neutral, 90))
        for tick in range(110,130):
            self.assertFalse(observe(policy, glance, tick))
        self.assertEqual(observe(policy, glance,130)[0].event_type, 'gaze_away')


    def test_worker_labels_and_confidence_tiers_are_server_authoritative(self):
        config = ModelConfig.model_validate(local_models()['local_yolo'])
        self.assertEqual(config.label_map['headphone'], 'object_headphone')
        for label, kind in (('cell phone', 'object_phone'), ('book', 'object_book'),
                            ('smartwatch', 'object_prohibited'), ('headphone', 'object_headphone'),
                            ('multiple_people', 'person_in_background')):
            policy = config.policies[kind]
            self.assertEqual(policy.severity_for(.30), SeverityLevel.medium, label)
            self.assertEqual(policy.severity_for(.99), SeverityLevel.high, label)
            self.assertTrue(policy.calibrated)
        from app.core.config import settings
        with patch.object(settings, 'PROCTOR_MODEL_ENABLED', True), patch.object(settings, 'PROCTOR_MODELS', local_models()):
            base = dict(provider='local_yolo', source='OBJECT', event_type='object_phone', confidence=.31)
            with self.assertRaises(HTTPException) as error:
                policy_for(SimpleNamespace(**base, severity=SeverityLevel.high), 'model')
            self.assertEqual(error.exception.status_code, 422)
            self.assertEqual(policy_for(SimpleNamespace(**base, severity=SeverityLevel.medium), 'model').severity,
                             SeverityLevel.medium)
            self.assertEqual(policy_for(SimpleNamespace(**{**base,'confidence':.88}, severity=SeverityLevel.high), 'model').severity,
                             SeverityLevel.medium)

    def test_gaze_requires_two_continuous_seconds_and_resets_on_neutral(self):
        config = ModelConfig.model_validate(local_models()['local_gaze'])
        self.assertEqual(set(config.label_map.values()), {'face_not_detected', 'gaze_away', 'head_turned'})
        self.assertEqual(config.policies['face_not_detected'].severity, SeverityLevel.low)
        context = AdapterContext(uuid4(), uuid4(), uuid4())
        start = datetime.now(timezone.utc)
        state = TemporalPolicy()

        def tick(ms, label):
            return state.normalize(context, 'local_gaze', config,
                [RawPrediction(label=label, occurred_at=start+timedelta(milliseconds=ms))])
        for ms in range(0, 1901, 100):
            self.assertFalse(tick(ms, 'QUAY_SANG_TRAI'))
        self.assertEqual(tick(2000, 'QUAY_SANG_TRAI')[0].severity, SeverityLevel.high)
        tick(2100, 'BINH_THUONG')
        for ms in range(2200, 4000, 100):
            self.assertFalse(tick(ms, 'LIEC_SANG_PHAI'))
        self.assertEqual(tick(4200, 'LIEC_SANG_PHAI')[0].event_type, 'gaze_away')


class GazeCalibrationLogTests(IsolatedAsyncioTestCase):
    async def test_dev_opt_in_logs_measurements_and_never_frame_bytes(self):
        adapter = LocalWorkerAdapter('gaze')
        adapter.client = type('Client', (), {})()
        adapter.client.post = AsyncMock(return_value=httpx.Response(200, request=httpx.Request('POST','http://worker/infer'), json={
            'gaze': {'status':'OK','face_detected':True,'yaw':12.5,'pitch':-4.0,'roll':1.25,
                     'gaze_ratio':0.58,'raw_status':'BINH_THUONG'},
            'timings_ms': {'gaze': 12.0, 'total': 12.0},
        }))
        frame = MonitoringFrame(b'private-camera-frame','image/jpeg',datetime.now(timezone.utc))
        with patch.object(settings,'ENVIRONMENT','development'), patch.object(settings,'PROCTOR_GAZE_CALIBRATION',True):
            with self.assertLogs('app.proctoring.gaze_calibration',level='INFO') as captured:
                await adapter.process_frame(frame)
        entry = json.loads(captured.output[0].split('gaze_calibration ',1)[1])
        self.assertEqual(set(entry),{'timestamp','yaw','pitch','roll','gaze_ratio','face_detected','raw_status'})
        self.assertEqual(entry['yaw'],12.5)
        self.assertEqual(entry['gaze_ratio'],0.58)
        self.assertTrue(entry['face_detected'])
        self.assertNotIn('private-camera-frame',captured.output[0])

    async def test_calibration_logs_stay_off_outside_development(self):
        adapter = LocalWorkerAdapter('gaze')
        adapter.client = type('Client', (), {})()
        adapter.client.post = AsyncMock(return_value=httpx.Response(200, request=httpx.Request('POST','http://worker/infer'), json={
            'gaze': {'status':'OK','face_detected':True,'yaw':0.0,'pitch':0.0,'roll':0.0,
                     'gaze_ratio':0.5,'raw_status':'BINH_THUONG'},
            'timings_ms': {},
        }))
        frame = MonitoringFrame(b'private-camera-frame','image/jpeg',datetime.now(timezone.utc))
        with patch.object(settings,'ENVIRONMENT','production'), patch.object(settings,'PROCTOR_GAZE_CALIBRATION',True):
            with self.assertNoLogs('app.proctoring.gaze_calibration',level='INFO'):
                await adapter.process_frame(frame)
