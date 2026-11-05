"""Opt-in real loopback worker + isolated HTTP/DB/WS test. Prerecorded input, NOT webcam proof."""
from datetime import datetime, timezone
from io import BytesIO
import os
from time import monotonic, sleep
from unittest import TestCase, skipUnless

from PIL import Image
from sqlalchemy import select

from app.core.security import create_access_token
from app.models.entities import DetectionEvent
from proctor_worker.protocol import MODELS
from tests import test_live_proctor_pipeline as fixtures


@skipUnless(os.environ.get('PROCTOR_WORKER_HTTP_TESTS') == '1', 'Requires the provisioned loopback worker; prerecorded input only')
class RealWorkerHTTPTests(TestCase):
    def test_real_inference_at_wall_clock_cadence_persists_phone_and_face_absence(self):
        pipeline = fixtures.LiveProctorPipelineTests()
        pipeline.setUp()
        self.addCleanup(pipeline.doCleanups)
        pipeline.start()
        self.addCleanup(lambda: pipeline.client.delete(pipeline.base + '/input', headers=pipeline.headers))
        with Image.open(MODELS / 'yolo26_results/yolo26n_eval_conf025/val_batch0_labels.jpg') as image:
            image.thumbnail((640, 640))
            output = BytesIO()
            image.convert('RGB').save(output, format='JPEG', quality=75)
        pipeline.image = output.getvalue()
        pipeline.start_time = datetime.now(timezone.utc)
        deadline = monotonic() + 30
        required = {'object_phone', 'face_not_detected'}
        stamps, kinds = [], set()
        with pipeline.client.websocket_connect('/api/v1/proctoring/ws') as socket:
            socket.send_json({'type': 'auth', 'token': create_access_token(str(pipeline.fixture.teacher.id), 'teacher')})
            self.assertEqual(socket.receive_json()['type'], 'ready')
            while monotonic() < deadline:
                started = monotonic()
                tick = int((datetime.now(timezone.utc) - pipeline.start_time).total_seconds() * 1000)
                stamps.append(tick)
                response = pipeline.frame(tick)
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.json()['data']['processed'])
                kinds = set(pipeline.db.scalars(select(DetectionEvent.event_type)))
                if required <= kinds:
                    break
                sleep(max(0, .1 - (monotonic() - started)))
            self.assertTrue(required <= kinds, f'Observed events: {sorted(kinds)}; frame gaps ms: {[b-a for a,b in zip(stamps,stamps[1:])]}')
            socket.send_text('ping')
            created = []
            while True:
                message = socket.receive_json()
                if message['type'] == 'ping':
                    break
                if message['type'] == 'proctor_event_created':
                    created.append(message['data']['id'])
        rows = pipeline.db.scalars(select(DetectionEvent).where(DetectionEvent.event_type.in_(required))).all()
        self.assertTrue(all(str(row.id) in created and not row.is_simulated for row in rows))
        warnings = pipeline.client.get(pipeline.base + '/warnings', headers=pipeline.headers).json()['data']
        self.assertTrue(required <= {item['event_type'] for item in warnings})
        self.assertTrue(all(item['id'] in created for item in warnings))
        print(f'PRERECORDED real worker: {len(stamps)} frames; phone + face absence delivered to teacher and student; physical webcam NOT tested')
