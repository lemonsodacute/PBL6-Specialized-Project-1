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

    def test_phone_continuous_holding_is_one_incident_but_removal_and_reappearance_is_two(self):
        config = ModelConfig.model_validate(local_models()['local_yolo'])
        self.assertEqual(config.policies['object_phone'].absence_reset_ms, 500)
        context = AdapterContext(uuid4(), uuid4(), uuid4())
        start = datetime.now(timezone.utc)
        detector = TemporalPolicy()

        def observe(ms, confidence=None):
            stamp = start + timedelta(milliseconds=ms)
            predictions = ([RawPrediction(label='cell phone', confidence=confidence,
                occurred_at=stamp)] if confidence is not None else [])
            return detector.normalize(context, 'local_yolo', config, predictions, observed_at=stamp)

        emitted = []
        # Two samples in the same episode are enough to trigger, while subsequent
        # identical frames must never inflate occurrence_count every 15 seconds.
        for stamp in range(0, 16251, 250):
            emitted.extend(observe(stamp, .84))
        self.assertEqual(len(emitted), 1)
        self.assertEqual(emitted[0].event_type, 'object_phone')
        first_incident_id = emitted[0].metadata.incident_id
        self.assertIsNotNone(first_incident_id)

        # A single missed inference does not count as the student hiding the phone.
        self.assertEqual(observe(16500), [])
        self.assertEqual(observe(16750, .84), [])
        self.assertEqual(observe(17000, .84), [])
        self.assertEqual(observe(17250, .84), [])

        # Two+ clean observations confirm the first incident ended.
        self.assertEqual(observe(17500), [])
        self.assertEqual(observe(17750), [])
        self.assertEqual(observe(18000, .84), [])
        self.assertEqual(observe(18250, .84), [])
        second = observe(18500, .84)
        self.assertEqual(len(second), 1)
        self.assertNotEqual(second[0].metadata.incident_id, first_incident_id)
        self.assertEqual(second[0].event_type, 'object_phone')
        self.assertEqual(second[0].severity, SeverityLevel.high)
        for stamp in range(18750, 19751, 250):
            self.assertFalse(observe(stamp, .84))

    def test_phone_confidence_upgrade_is_not_a_second_incident(self):
        config = ModelConfig.model_validate(local_models()['local_yolo'])
        context = AdapterContext(uuid4(), uuid4(), uuid4())
        start = datetime.now(timezone.utc)
        detector = TemporalPolicy()

        def observe(ms, confidence):
            stamp = start + timedelta(milliseconds=ms)
            return detector.normalize(context, 'local_yolo', config,
                [RawPrediction(label='cell phone', confidence=confidence, occurred_at=stamp)],
                observed_at=stamp)

        self.assertFalse(observe(0, .35))
        self.assertFalse(observe(250, .35))
        medium = observe(500, .35)
        self.assertEqual([event.severity for event in medium], [SeverityLevel.medium])
        high = observe(750, .88)
        self.assertEqual([event.severity for event in high], [SeverityLevel.high])
        self.assertEqual(high[0].metadata.incident_id, medium[0].metadata.incident_id)
        self.assertFalse(observe(1000, .88))


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


class CalibratedGazeDirectionTests(TestCase):
    """Synthetic blendshape/pose measurements, not webcam accuracy claims."""

    @staticmethod
    def gaze(*, yaw=5.0, pitch=-3.0, roll=1.0, eye_h=.1, eye_v=-.05, blink=False):
        return Gaze(status='OK', face_detected=True, yaw=yaw, pitch=pitch, roll=roll,
                    gaze_ratio=.5, eye_h=eye_h, eye_v=eye_v, blink=blink,
                    raw_status='BINH_THUONG')

    def test_all_four_eye_directions_and_head_movements_reach_review_policy(self):
        config = ModelConfig.model_validate(local_models()['local_gaze'])
        scenarios = (
            ({'eye_h': -.50}, 'LIEC_SANG_TRAI', 'gaze_away'),
            ({'eye_h': .70}, 'LIEC_SANG_PHAI', 'gaze_away'),
            ({'eye_v': .48}, 'LIEC_LEN_TREN', 'gaze_away'),
            ({'eye_v': -.55}, 'LIEC_XUONG_DUOI', 'gaze_away'),
            ({'yaw': -23.0}, 'QUAY_SANG_TRAI', 'head_turned'),
            ({'yaw': 33.0}, 'QUAY_SANG_PHAI', 'head_turned'),
            ({'pitch': 17.0}, 'NGUA_LEN_TREN', 'head_turned'),
            ({'pitch': -23.0}, 'CUI_XUONG_BAN', 'head_turned'),
            ({'roll': 35.0}, 'NGHIENG_DAU', 'head_turned'),
        )
        for values, label, kind in scenarios:
            with self.subTest(label=label):
                adapter = LocalWorkerAdapter('gaze')
                policy = TemporalPolicy()
                context = AdapterContext(uuid4(), uuid4(), uuid4())
                started = datetime.now(timezone.utc)

                def sample(index, reading):
                    stamp = started + timedelta(milliseconds=index * 100)
                    predictions = adapter.gaze_predictions(reading, stamp)
                    events = policy.normalize(context, 'local_gaze', config, predictions,
                                              observed_at=stamp)
                    return predictions, events

                # Three seconds of straight-ahead measurements belong solely to
                # this attempt; calibration itself must not create violations.
                for tick in range(31):
                    predictions, events = sample(tick, self.gaze())
                    self.assertEqual(predictions[0].label, 'BINH_THUONG')
                    self.assertFalse(events)
                self.assertIsNotNone(adapter.gaze_baseline)
                detections = []
                labels = []
                for tick in range(31, 76):
                    predictions, events = sample(tick, self.gaze(**values))
                    labels.append(predictions[0].label)
                    detections.extend(events)
                self.assertIn(label, labels)
                self.assertEqual([(event.event_type, event.severity) for event in detections],
                                 [(kind, SeverityLevel.high)])
                self.assertIsNotNone(detections[0].metadata.incident_id)

    def test_blinks_do_not_trigger_gaze_away(self):
        adapter = LocalWorkerAdapter('gaze')
        config = ModelConfig.model_validate(local_models()['local_gaze'])
        policy = TemporalPolicy()
        context = AdapterContext(uuid4(), uuid4(), uuid4())
        start = datetime.now(timezone.utc)
        for tick in range(31):
            stamp = start + timedelta(milliseconds=tick*100)
            policy.normalize(context, 'local_gaze', config,
                             adapter.gaze_predictions(self.gaze(), stamp), observed_at=stamp)
        for tick in range(31, 71):
            stamp = start + timedelta(milliseconds=tick*100)
            readings = adapter.gaze_predictions(self.gaze(eye_h=.99, eye_v=.90, blink=True), stamp)
            self.assertEqual(readings[0].label, 'BINH_THUONG')
            self.assertFalse(policy.normalize(context, 'local_gaze', config, readings, observed_at=stamp))

    def test_gaze_repeated_after_returning_to_center_counts_new_incident(self):
        adapter = LocalWorkerAdapter('gaze')
        config = ModelConfig.model_validate(local_models()['local_gaze'])
        policy = TemporalPolicy()
        context = AdapterContext(uuid4(), uuid4(), uuid4())
        start = datetime.now(timezone.utc)
        incidents = []

        def run(start_tick, end_tick, reading):
            for tick in range(start_tick, end_tick):
                stamp = start + timedelta(milliseconds=tick*100)
                predicted = adapter.gaze_predictions(reading, stamp)
                incidents.extend(policy.normalize(context, 'local_gaze', config, predicted,
                                                  observed_at=stamp))

        run(0, 31, self.gaze())
        run(31, 76, self.gaze(eye_h=.70))
        run(76, 91, self.gaze())
        run(91, 136, self.gaze(eye_h=.70))
        self.assertEqual([i.event_type for i in incidents], ['gaze_away', 'gaze_away'])
        self.assertNotEqual(incidents[0].metadata.incident_id, incidents[1].metadata.incident_id)

    def test_missing_face_keeps_absence_alert_and_never_invents_eye_direction(self):
        adapter = LocalWorkerAdapter('gaze')
        config = ModelConfig.model_validate(local_models()['local_gaze'])
        policy = TemporalPolicy()
        context = AdapterContext(uuid4(), uuid4(), uuid4())
        start = datetime.now(timezone.utc)
        missing = Gaze(status='OK', face_detected=False, raw_status='KHONG_THAY_MAT')
        events = []
        for tick in range(24):
            stamp = start + timedelta(milliseconds=tick*100)
            predictions = adapter.gaze_predictions(missing, stamp)
            events.extend(policy.normalize(context, 'local_gaze', config, predictions, observed_at=stamp))
        self.assertEqual([(e.event_type, e.severity) for e in events],
                         [('face_not_detected', SeverityLevel.low)])
        self.assertIsNone(adapter.gaze_baseline)
