import math
import json
import logging
from collections import defaultdict
import httpx
from app.core.config import settings
from app.proctoring.adapters import RawPrediction
from app.proctoring.contracts import EvidenceSummary
from app.proctoring.diagnostics import diagnostic
from proctor_worker.protocol import KEY_FILE, URL, Result, reference_state

logger = logging.getLogger('app.proctoring.gaze_calibration')


class LocalWorkerAdapter:
    def __init__(self, module):
        self.module = module
        self.client = None
        self.previous = None
        self.angles = None
        self.latest_calibration_sample = None

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
        for label in ('cell phone', 'book', 'smartwatch', 'person'):
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
            return [RawPrediction(label='KHONG_THAY_MAT', occurred_at=stamp)]
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
