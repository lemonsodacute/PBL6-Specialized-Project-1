import math
import json
import logging
from collections import defaultdict, deque
from statistics import median
import httpx
from app.core.config import settings
from app.proctoring.adapters import RawPrediction
from app.proctoring.contracts import EvidenceSummary
from app.proctoring.diagnostics import diagnostic
from proctor_worker.protocol import KEY_FILE, URL, Result, reference_state

logger = logging.getLogger('app.proctoring.gaze_calibration')

# Relative scales and 3-second neutral calibration are adapted from the
# supplied gaze_tracking1.py. These are review/demo defaults, not validated
# cheating thresholds; the server still requires 2 seconds of sustained gaze.
GAZE_YAW_SCALE = 20.0
GAZE_PITCH_SCALE = 15.0
GAZE_EYE_H_SCALE = 0.35
GAZE_EYE_V_SCALE = 0.30
GAZE_ENTER = 1.0
GAZE_EXIT = 0.8
GAZE_CALIBRATION_SECONDS = 3.0
GAZE_CALIBRATION_MIN_FRAMES = 15
GAZE_ROLL_THRESHOLD = 25.0



class LocalWorkerAdapter:
    def __init__(self, module):
        self.module = module
        self.client = None
        self.previous = None
        self.angles = None
        self.latest_calibration_sample = None
        # Stored on the per-attempt adapter, never in the shared inference
        # worker, to prevent baseline mixing between different students.
        self.gaze_baseline = None
        self.gaze_calibration_start = None
        self.gaze_calibration_samples = deque(maxlen=120)
        self.gaze_smooth = defaultdict(lambda: deque(maxlen=5))
        self.gaze_last_eyes = None
        self.gaze_away = False

    async def start(self, context):
        key = KEY_FILE.read_text(encoding='ascii').strip()
        if len(key) < 32:
            raise RuntimeError('Invalid worker credential')
        self.client = httpx.AsyncClient(base_url=URL, headers={'X-Proctor-Worker-Key':key},
            timeout=settings.PROCTOR_MODEL_TIMEOUT, trust_env=False, follow_redirects=False)
        diagnostic('adapter_started', module=self.module, worker_url=URL)

    async def stop(self):
        if self.client:
            await self.client.aclose()

    async def process_frame(self, frame):
        diagnostic('worker_request', trace=frame.trace_id, module=self.module)
        response = await self.client.post('/infer', params={'module':self.module},
            headers={'Content-Type':frame.content_type, **({'X-Proctor-Trace':frame.trace_id} if frame.trace_id else {})}, content=frame.content)
        diagnostic('worker_response', trace=frame.trace_id, module=self.module, status=response.status_code)
        if response.status_code == 429:
            raise httpx.PoolTimeout('Worker busy')
        response.raise_for_status()
        result = Result.model_validate_json(response.content)
        observation = getattr(result, self.module)
        diagnostic('worker_observation', trace=frame.trace_id, module=self.module,
            status=observation.status if observation else 'MISSING',
            **({'face_detected':observation.face_detected} if self.module == 'gaze' and observation else
               {'detections':dict((label,sum(box.class_name == label for box in observation.detections))
                    for label in ('cell phone','person','book','smartwatch'))} if observation else {}))
        if observation is None or observation.status != 'OK':
            raise RuntimeError('Module unavailable')
        if self.module == 'gaze':
            if settings.ENVIRONMENT.lower() in {'development', 'dev', 'local'} and settings.PROCTOR_GAZE_CALIBRATION:
                self.latest_calibration_sample = {
                    'timestamp': frame.occurred_at.isoformat(),
                    'yaw': observation.yaw,
                    'pitch': observation.pitch,
                    'roll': observation.roll,
                    'gaze_ratio': observation.gaze_ratio,
                    'eye_h': observation.eye_h,
                    'eye_v': observation.eye_v,
                    'blink': observation.blink,
                    'face_detected': observation.face_detected,
                    'raw_direction': observation.raw_status,
                }
                logger.info('gaze_calibration %s', json.dumps({
                    'timestamp': frame.occurred_at.isoformat(),
                    'yaw': observation.yaw,
                    'pitch': observation.pitch,
                    'roll': observation.roll,
                    'gaze_ratio': observation.gaze_ratio,
                    'face_detected': observation.face_detected,
                    'raw_status': observation.raw_status,
                }, allow_nan=False, separators=(',', ':')))
            return self.gaze_predictions(observation, frame.occurred_at)
        groups = defaultdict(list)
        for box in observation.detections:
            groups[box.class_name].append(box)
        candidates = []
        for label in ('cell phone', 'book', 'smartwatch', 'headphone', 'person'):
            boxes = sorted(groups[label], key=lambda box: box.confidence, reverse=True)
            needed = 2 if label == 'person' else 1
            if len(boxes) < needed:
                continue
            candidates.append(RawPrediction(label='multiple_people' if needed == 2 else label,
                confidence=boxes[needed-1].confidence, occurred_at=frame.occurred_at,
                evidence=EvidenceSummary(timestamp=frame.occurred_at, bounding_boxes=[b.bbox for b in boxes[:20]])))
        return candidates

    def gaze_predictions(self, observation, stamp):
        if not observation.face_detected:
            self.previous = self.angles = None
            self.gaze_smooth.clear()
            self.gaze_away = False
            if self.gaze_baseline is None:
                self.gaze_calibration_start = None
                self.gaze_calibration_samples.clear()
            return [RawPrediction(label='KHONG_THAY_MAT', occurred_at=stamp)]
        # New worker measurements enable eye left/right/up/down detection.
        # Keep the old ratio pathway for an older worker/test fixture that has
        # not yet been upgraded; never affect the independent YOLO adapter.
        if observation.eye_h is not None and observation.eye_v is not None:
            return self.calibrated_gaze_predictions(observation, stamp)
        current = [observation.yaw, observation.pitch, observation.roll, observation.gaze_ratio]
        dt = (stamp-self.previous).total_seconds() if self.previous else 0
        if self.angles is not None and 0 < dt <= .6:
            weight = 1 - math.exp(-dt/.2)
            for axis, (new, old) in enumerate(zip(current, self.angles)):
                if axis in (1, 2):
                    delta = (new-old+180) % 360 - 180
                    current[axis] = (old+weight*delta+180) % 360 - 180
                else:
                    current[axis] = old+weight*(new-old)
        self.previous, self.angles = stamp, current
        label = reference_state(current[0], current[1], current[3])
        return [RawPrediction(label=label, occurred_at=stamp)]

    def calibrated_gaze_predictions(self, observation, stamp):
        """Classify sustained *relative* eye/head movement for this attempt.

        The worker sends only per-frame measurements. Calibration, blink
        suppression, smoothing and hysteresis live here, so different students
        cannot share a baseline or temporal tracking state.
        """
        # A stalled camera/CPU must not carry a previous away state forward.
        if self.previous is not None and not 0 < (stamp - self.previous).total_seconds() <= .6:
            self.gaze_smooth.clear()
            self.gaze_away = False
        self.previous = stamp
        values = {
            'yaw': observation.yaw, 'pitch': observation.pitch,
            'roll': observation.roll, 'eye_h': observation.eye_h,
            'eye_v': observation.eye_v,
        }
        neutral = [RawPrediction(label='BINH_THUONG', occurred_at=stamp)]
        if self.gaze_baseline is None:
            if self.gaze_calibration_start is None or stamp < self.gaze_calibration_start:
                self.gaze_calibration_start = stamp
                self.gaze_calibration_samples.clear()
            if not observation.blink:
                self.gaze_calibration_samples.append(values)
            elapsed = (stamp - self.gaze_calibration_start).total_seconds()
            if elapsed < GAZE_CALIBRATION_SECONDS or len(self.gaze_calibration_samples) < GAZE_CALIBRATION_MIN_FRAMES:
                return neutral
            self.gaze_baseline = {
                key: float(median(sample[key] for sample in self.gaze_calibration_samples))
                for key in values
            }
            self.gaze_last_eyes = (values['eye_h'], values['eye_v'])
            self.gaze_smooth.clear()
            return neutral

        # Ignore transient eyeLook peaks while blinking, without losing the
        # independently measured head pose.
        if observation.blink and self.gaze_last_eyes is not None:
            values['eye_h'], values['eye_v'] = self.gaze_last_eyes
        elif not observation.blink:
            self.gaze_last_eyes = (values['eye_h'], values['eye_v'])
        for key, value in values.items():
            self.gaze_smooth[key].append(value)
        smooth = {key: sum(samples)/len(samples) for key, samples in self.gaze_smooth.items()}
        base = self.gaze_baseline

        # Current PBL6 head_pose() reports pitch positive when looking UP.
        # (The supplied standalone script uses the opposite pitch convention.)
        hx = (smooth['yaw'] - base['yaw']) / GAZE_YAW_SCALE
        hy = (smooth['pitch'] - base['pitch']) / GAZE_PITCH_SCALE
        sx = hx + (smooth['eye_h'] - base['eye_h']) / GAZE_EYE_H_SCALE
        sy = hy + (smooth['eye_v'] - base['eye_v']) / GAZE_EYE_V_SCALE
        roll_delta = (smooth['roll'] - base['roll'] + 180) % 360 - 180
        head_magnitude = max(abs(hx), abs(hy))
        eye_head_magnitude = max(abs(sx), abs(sy))
        magnitude = max(head_magnitude, eye_head_magnitude, abs(roll_delta) / GAZE_ROLL_THRESHOLD)

        if self.gaze_away:
            if magnitude < GAZE_EXIT:
                self.gaze_away = False
        elif magnitude > GAZE_ENTER:
            self.gaze_away = True
        if not self.gaze_away:
            return neutral

        if abs(roll_delta) > GAZE_ROLL_THRESHOLD and abs(roll_delta) / GAZE_ROLL_THRESHOLD >= max(head_magnitude, eye_head_magnitude):
            label = 'NGHIENG_DAU'
        elif head_magnitude >= eye_head_magnitude:
            if abs(hx) >= abs(hy):
                label = 'QUAY_SANG_PHAI' if hx > 0 else 'QUAY_SANG_TRAI'
            else:
                label = 'NGUA_LEN_TREN' if hy > 0 else 'CUI_XUONG_BAN'
        elif abs(sx) >= abs(sy):
            label = 'LIEC_SANG_PHAI' if sx > 0 else 'LIEC_SANG_TRAI'
        else:
            label = 'LIEC_LEN_TREN' if sy > 0 else 'LIEC_XUONG_DUOI'
        return [RawPrediction(label=label, occurred_at=stamp)]
