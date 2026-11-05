import asyncio
from contextlib import asynccontextmanager
from io import BytesIO
import json
import logging
import os
import secrets
import struct
from time import perf_counter
from typing import Literal
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from PIL import Image
from starlette.concurrency import run_in_threadpool
from .protocol import BACKEND, KEY_FILE, Gaze, Objects, Result

logger = logging.getLogger('proctor.worker')
if os.environ.get('PROCTOR_DIAGNOSTICS','').lower() in {'1','true','yes'}:
    logger.setLevel(logging.INFO)
    if not logger.hasHandlers():
        logger.addHandler(logging.StreamHandler())
MAX_BYTES = 1024 * 1024


class YoloChild:
    def __init__(self):
        self.process = None
        self.ready = False

    async def start(self):
        base = BACKEND / 'proctor_worker/yolo_runtime'
        exe = base / ('.venv/Scripts/python.exe' if os.name == 'nt' else '.venv/bin/python')
        self.process = await asyncio.create_subprocess_exec(str(exe), '-B', str(base/'detect.py'),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, limit=131072)
        line = await asyncio.wait_for(self.process.stdout.readline(), 90)
        if json.loads(line) != {'ready': True}:
            raise RuntimeError('YOLO startup failed')
        self.ready = True

    async def stop(self):
        self.ready = False
        if self.process and self.process.returncode is None:
            self.process.kill()
            await self.process.wait()

    async def detect(self, data):
        if not self.ready or self.process.returncode is not None:
            return Objects(status='UNAVAILABLE')
        try:
            self.process.stdin.write(struct.pack('!I', len(data)) + data)
            await self.process.stdin.drain()
            line = await asyncio.wait_for(self.process.stdout.readline(), 6)
            return Objects.model_validate_json(line)
        except (Exception, asyncio.CancelledError):
            # A delayed reply must never be attributed to another frame.
            await self.stop()
            raise


@asynccontextmanager
async def lifespan(app):
    key = KEY_FILE.read_text(encoding='ascii').strip()
    if len(key) < 32:
        raise RuntimeError('Provision the local worker key before startup')
    app.state.key = key
    app.state.busy = False
    app.state.yolo = YoloChild()
    app.state.gaze = None
    try:
        from .gaze_detector import GazeAndHeadTracker
        app.state.gaze = await run_in_threadpool(GazeAndHeadTracker)
    except Exception:
        logger.exception('Gaze initialization failed')
    try:
        await app.state.yolo.start()
    except Exception:
        await app.state.yolo.stop()
        logger.exception('Object detector initialization failed')
    try:
        yield
    finally:
        await app.state.yolo.stop()
        if app.state.gaze:
            await run_in_threadpool(app.state.gaze.close)


def authorize(request: Request, x_proctor_worker_key: str = Header(default='')):
    if request.headers.get('origin') or not secrets.compare_digest(
            x_proctor_worker_key.encode(), request.app.state.key.encode()):
        raise HTTPException(403)


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None,
              dependencies=[Depends(authorize)])


@app.get('/health')
def health():
    yolo = app.state.yolo
    ready = yolo.ready and yolo.process.returncode is None
    return {'yolo': 'READY' if ready else 'UNAVAILABLE', 'model_loaded': ready, 'device': 'cpu',
            'gaze': 'UNCALIBRATED' if app.state.gaze else 'UNAVAILABLE'}


def validate_image(data, mime):
    with Image.open(BytesIO(data)) as image:
        if image.format != {'image/jpeg':'JPEG', 'image/png':'PNG'}.get(mime) or image.width*image.height > 2_000_000:
            raise ValueError('Invalid image')
        image.verify()


def gaze_infer(tracker, data):
    import cv2
    import numpy as np
    frame = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError('Invalid image')
    return tracker.analyze_frame(frame)


@app.post('/infer', response_model=Result, response_model_exclude_none=True)
async def infer(request: Request, module: Literal['object_detection', 'gaze', 'both']='both'):
    started = perf_counter()
    try: trace=str(UUID(request.headers.get('x-proctor-trace','')))
    except ValueError: trace=str(uuid4())
    diagnostics=os.environ.get('PROCTOR_DIAGNOSTICS','').lower() in {'1','true','yes'}
    if app.state.busy:
        raise HTTPException(429, 'Worker busy')
    app.state.busy = True
    try:
        mime = request.headers.get('content-type')
        if mime not in ('image/jpeg', 'image/png'):
            raise HTTPException(415)
        data = bytearray()
        async for chunk in request.stream():
            if len(data)+len(chunk) > MAX_BYTES:
                raise HTTPException(413)
            data.extend(chunk)
        try:
            await run_in_threadpool(validate_image, data, mime)
        except Exception:
            raise HTTPException(422, 'Invalid image') from None
        times = {}
        objects = gaze = None
        if module in ('both', 'object_detection'):
            start = perf_counter()
            try:
                objects = await app.state.yolo.detect(data)
            except Exception:
                objects = Objects(status='UNAVAILABLE')
            times['yolo'] = (perf_counter()-start)*1000
        if module in ('both', 'gaze'):
            start = perf_counter()
            try:
                gaze = await run_in_threadpool(gaze_infer, app.state.gaze, data) if app.state.gaze else Gaze(status='UNAVAILABLE')
            except Exception:
                gaze = Gaze(status='UNAVAILABLE')
            times['gaze'] = (perf_counter()-start)*1000
        times['total'] = (perf_counter()-started)*1000
        if diagnostics:
            logger.info('proctor_pipeline %s', json.dumps({'stage':'worker_infer','trace':trace,'module':module,
                'objects_status':objects.status if objects else None, 'detections':len(objects.detections) if objects else None,
                'phone_count':sum(box.class_name == 'cell phone' for box in objects.detections) if objects else None,
                'gaze_status':gaze.status if gaze else None,'face_detected':gaze.face_detected if gaze else None,
                'timings_ms':times}, separators=(',', ':')))
        return Result(object_detection=objects, gaze=gaze, timings_ms=times)
    finally:
        app.state.busy = False
