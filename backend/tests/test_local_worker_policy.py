from datetime import datetime, timedelta, timezone
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, patch
import json
import httpx
from uuid import uuid4
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
        self.assertEqual(sample(1000, True)[0].event_type, 'object_phone')
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
        for tick in range(30):
            self.assertFalse(observe(policy, glance, tick))
        for tick in range(30, 50):
            self.assertFalse(observe(policy, missing, tick))
        self.assertEqual(observe(policy, missing, 50)[0].event_type, 'face_not_detected')
        self.assertFalse(observe(policy, neutral, 51))
        self.assertFalse(observe(policy, missing, 52))
        self.assertFalse(observe(policy, neutral, 53))
        # Explicit test-only calibration policy. The shipping profile omits direction events.
        config.label_map['LIEC_SANG_TRAI'] = 'gaze_away'
        config.policies['gaze_away'] = config.policies['face_not_detected']
        policy = TemporalPolicy()
        self.assertFalse(observe(policy, glance, 80))
        self.assertFalse(observe(policy, neutral, 90))
        for tick in range(110,130):
            self.assertFalse(observe(policy, glance, tick))
        self.assertEqual(observe(policy, glance,130)[0].event_type, 'gaze_away')


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
