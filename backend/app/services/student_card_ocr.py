"""Backend OCR adapter. An isolated local process caches the OCR engine once.

Start during server startup, never from a student's request. No network API,
temporary card files, dependency installation or model downloads occur here.
"""
import base64
import json
import logging
import math
import os
from pathlib import Path
from queue import Empty, Queue
import subprocess
from threading import Lock, Thread
from uuid import uuid4

from app.services.student_card_matching import FieldOCR, LABELS, OCRLine, OCRResult, OCRToken, parse_fields
from app.services.student_card_field_ocr import NAME_PREPROCESSING

BACKEND = Path(__file__).resolve().parents[2]
MODEL_VERSION = 'tesseract-5.5.2-vie-eng-e12c65a'
logger = logging.getLogger(__name__)


def log_name_debug(result):
    # Identity text never reaches production logs, even at DEBUG log level.
    if settings.ENVIRONMENT != 'development':
        return
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter('%(asctime)s %(message)s'))
        logger.addHandler(handler)
        logger.propagate = False
    logger.setLevel(logging.INFO)
    events = []
    parse_fields(result, diagnostics=events)
    for event in [*getattr(result, 'pipeline_diagnostics', []), *events]:
        tag = event.get('event')
        if tag not in ('NAME_LABEL', 'NAME_CANDIDATE', 'CLASS_LABEL', 'CLASS_CANDIDATE', 'CLASS_RESULT'):
            tag = 'NAME_RESULT' if event.get('field') == 'full_name' and 'extracted' in event else None
        if tag:
            # Diagnostics retain numeric quality information, never names,
            # student IDs, class text, OCR lines or private card content.
            safe = {key: event[key] for key in ('confidence', 'score', 'candidate_count', 'accepted')
                    if key in event and type(event[key]) in (int, float, bool)}
            logger.info('%s %s', tag, json.dumps(safe))


class OCRError(RuntimeError):
    def __init__(self, code='OCR_FAILED'):
        self.code = code
        super().__init__(code)


def _read_observation(row):
    if not isinstance(row, dict):
        raise OCRError()
    text, confidence, bbox = row.get('text'), row.get('confidence'), row.get('bbox')
    if (not isinstance(text, str) or not text.strip() or len(text) > 512
            or type(confidence) not in (float, int) or not math.isfinite(confidence)
            or not 0 <= confidence <= 1):
        raise OCRError()
    if bbox is not None:
        if (not isinstance(bbox, list) or len(bbox) != 4
                or any(type(n) is not int or n < 0 for n in bbox)
                or bbox[2] <= bbox[0] or bbox[3] <= bbox[1]):
            raise OCRError()
        bbox = tuple(bbox)
    return text.strip(), float(confidence), bbox


class LocalOCR:
    def __init__(self, *, code_charset='alphanumeric'):
        if code_charset not in ('numeric', 'alphanumeric'):
            raise ValueError('Unsupported student code charset')
        self.code_charset = code_charset
        self.process = None
        self.ready = False
        self.lock = Lock()
        self.messages = Queue()
        self.reader = None

    def start(self):
        with self.lock:
            if self.process is not None:
                return
            self.messages = Queue()
            python = BACKEND / '.venv-ocr' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
            if not python.is_file() or not (BACKEND / 'models/ocr/tessdata/manifest.json').is_file():
                raise OCRError('MODEL_ERROR')
            self.process = subprocess.Popen([str(python), '-u', str(BACKEND / 'scripts/student_card_ocr_worker.py')],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                text=True, encoding='utf-8', creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            process = self.process
            messages = self.messages
            def reader():
                for line in process.stdout:
                    messages.put(line)
                messages.put(None)
            self.reader = Thread(target=reader, daemon=True)
            self.reader.start()
            try:
                message = self._receive(120)
            except OCRError:
                self.close()
                raise
            if message != {'ready': True, 'version': MODEL_VERSION}:
                self.close()
                raise OCRError('MODEL_ERROR')
            self.ready = True

    def _receive(self, timeout):
        try:
            line = self.messages.get(timeout=timeout)
            if line is None:
                raise OCRError('MODEL_ERROR')
            return json.loads(line)
        except (Empty, ValueError):
            raise OCRError('MODEL_ERROR') from None

    def recognize(self, content: bytes) -> OCRResult:
        # Do not wait for model startup while holding a student's HTTP request.
        if not self.ready or self.process is None or self.process.poll() is not None:
            raise OCRError('MODEL_ERROR')
        with self.lock:
            request_id = uuid4().hex
            if not self.ready or self.process is None or self.process.poll() is not None:
                raise OCRError('MODEL_ERROR')
            try:
                self.process.stdin.write(json.dumps({'id': request_id,
                    'image': base64.b64encode(content).decode('ascii'), 'code_charset': self.code_charset,
                    'name_debug': settings.ENVIRONMENT == 'development'}) + '\n')
                self.process.stdin.flush()
                response = self._receive(45)
            except (OSError, OCRError):
                self.ready = False
                raise OCRError('MODEL_ERROR') from None
            if response.get('id') != request_id:
                self.ready = False
                raise OCRError('MODEL_ERROR')
            if response.get('error'):
                raise OCRError()
            rows = response.get('lines', [])
            if not isinstance(rows, list) or not rows or len(rows) > 128:
                raise OCRError()
            result = []
            for row in rows:
                text, confidence, bbox = _read_observation(row)
                tokens = row.get('tokens', [])
                if not isinstance(tokens, list) or len(tokens) > 128:
                    raise OCRError()
                words = []
                for token in tokens:
                    observation = _read_observation(token)
                    symbols = token.get('symbols', [])
                    glyphs = []
                    if isinstance(symbols, list) and len(symbols) <= 512:
                        for symbol in symbols:
                            try:
                                glyphs.append(OCRToken(*_read_observation(symbol)))
                            except OCRError:
                                # Optional symbol metadata cannot invalidate
                                # usable word/line OCR for the whole card.
                                continue
                    words.append(OCRToken(*observation, tuple(glyphs)))
                result.append(OCRLine(text, confidence, bbox, tuple(words)))
            fields = response.get('field_ocr', [])
            if not isinstance(fields, list) or len(fields) > 12:
                fields = []
            reads = []
            for row in fields:
                try:
                    text, confidence, bbox = _read_observation(row)
                except OCRError:
                    continue
                if (row.get('field') not in LABELS or bbox is None
                        or any(type(row.get(key)) is not int or not 0 <= row[key] < len(result)
                               for key in ('label_line', 'candidate_line'))
                        or row.get('language') not in ('vie', 'eng', 'vie+eng')
                        or type(row.get('psm')) is not int or row['psm'] not in (6, 7)
                        or row.get('preprocessing') not in NAME_PREPROCESSING | {
                            'gray-contrast-sharpen-2x', 'gray-contrast-sharpen-3x', 'otsu-3x'}):
                    continue
                reads.append(FieldOCR(row['field'], row['label_line'], row['candidate_line'],
                    text, confidence, bbox, row['language'], row['psm'], row['preprocessing']))
            recognized = OCRResult(result, reads)
            global_count = response.get('global_line_count', len(result))
            if type(global_count) is int and 0 <= global_count <= len(result):
                recognized.raw_global_ocr = tuple(result[:global_count])
            recognized.pipeline_diagnostics = response.get('diagnostics', [])
            log_name_debug(recognized)
            return recognized

    def close(self):
        self.ready = False
        if self.process is not None:
            if self.process.poll() is None:
                self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
            if self.reader:
                self.reader.join(timeout=2)
            self.process.stdin.close()
            self.process.stdout.close()
            self.process = None


from app.core.config import settings

ocr = LocalOCR(code_charset=settings.STUDENT_CARD_CODE_CHARSET)
