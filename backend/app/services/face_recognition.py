"""Single local YuNet/SFace pipeline for encoded JPEG/PNG/WEBP image bytes.

SFace receives a BGR uint8 aligned crop. OpenCV's feature() handles the
RGB tensor conversion at scale=1, mean=0; do not apply ArcFace normalization.
"""
from __future__ import annotations

from io import BytesIO
import json
import logging
import math
from pathlib import Path
from threading import Lock
from typing import TYPE_CHECKING, Literal, TypedDict
import warnings

from fastapi import HTTPException

from app.core.face_config import (
    EMBEDDING_DIM, CARD_FACE_QUALITY, CARD_MIN_FACE_SIZE,
    LIVE_FACE_QUALITY, LIVE_MIN_FACE_SIZE,
)

if TYPE_CHECKING:
    import numpy as np
    from numpy.typing import NDArray
    from PIL.Image import Image

MODEL_DIR = Path(__file__).resolve().parents[2] / 'models' / 'face'
DETECTOR_NAME = 'face_detection_yunet_2023mar.onnx'
RECOGNIZER_NAME = 'face_recognition_sface_2021dec.onnx'
MAX_IMAGE_BYTES = 8 * 1024 * 1024
CARD_FACE_QUALITY_MESSAGE = 'Khuôn mặt trên thẻ quá nhỏ hoặc chưa đủ rõ. Vui lòng chụp ảnh thẻ gần hơn, rõ nét hơn.'
CARD_FACE_BLUR_MESSAGE = 'Khuôn mặt trên thẻ bị mờ. Vui lòng tải ảnh thẻ rõ nét hơn, tránh rung và mất nét.'
logger = logging.getLogger(__name__)


def _log_card_debug(diagnostics: dict) -> None:
    from app.core.config import get_settings

    settings = get_settings()
    if settings.CARD_FACE_DEBUG and settings.ENVIRONMENT.lower() in {'development', 'local', 'test'}:
        # Geometry and scalar quality only: never images, embeddings or OCR text.
        logger.info('CARD_FACE_DEBUG: %s', ' '.join(
            f'{key}={json.dumps(value, separators=(",", ":"))}' for key, value in diagnostics.items()))


class VerificationResult(TypedDict):
    matched: bool
    similarity: float


def face_error(code: str, message: str, status: int = 422) -> HTTPException:
    return HTTPException(status, detail={'code': code, 'message': message, 'details': None})


def _normalize_embedding(values, *, model_output: bool = False) -> NDArray[np.float64]:
    import numpy as np

    code, status = ('MODEL_ERROR', 503) if model_output else ('INVALID_EMBEDDING', 422)
    try:
        if np.iscomplexobj(values):
            raise ValueError('Complex embedding')
        vector = np.asarray(values, dtype=np.float64)
        if vector.shape != (EMBEDDING_DIM,) or not np.isfinite(vector).all():
            raise ValueError('Expected 128 finite values')
        scale = np.max(np.abs(vector))
        if scale == 0:
            raise ValueError('Zero embedding')
        # Scaling first avoids overflow/underflow for non-unit caller inputs.
        scaled = vector / scale
        return scaled / np.linalg.norm(scaled)
    except (TypeError, ValueError, OverflowError) as exc:
        raise face_error(code, 'Embedding phải gồm 128 giá trị hữu hạn và có độ dài khác 0.', status) from exc


def compare_embeddings(first: NDArray[np.float32], second: NDArray[np.float32]) -> float:
    """Cosine similarity in [-1, 1]; accepts non-unit vectors, loads no model."""
    import numpy as np

    return float(np.clip(np.dot(_normalize_embedding(first), _normalize_embedding(second)), -1, 1))


class FaceEngine:
    def __init__(self, *, detector_path: Path | None = None, recognizer_path: Path | None = None):
        try:
            import cv2
            import numpy as np
            from PIL import Image, ImageOps
        except ImportError as exc:
            raise face_error('MODEL_ERROR', 'Máy chủ chưa sẵn sàng nhận diện. Vui lòng liên hệ quản trị viên.', 503) from exc
        self.cv, self.np, self.Image, self.ImageOps = cv2, np, Image, ImageOps
        detector_path = Path(detector_path) if detector_path is not None else MODEL_DIR / DETECTOR_NAME
        recognizer_path = Path(recognizer_path) if recognizer_path is not None else MODEL_DIR / RECOGNIZER_NAME
        if not all(path.is_file() for path in (detector_path, recognizer_path)):
            raise face_error('MODEL_ERROR', 'Máy chủ chưa sẵn sàng nhận diện. Vui lòng liên hệ quản trị viên.', 503)
        try:
            self.detector = cv2.FaceDetectorYN.create(str(detector_path), '', (320, 320), 0.85, 0.3, 5000)
            self.recognizer = cv2.FaceRecognizerSF.create(str(recognizer_path), '')
        except cv2.error as exc:
            raise face_error('MODEL_ERROR', 'Không thể tải mô hình nhận diện. Vui lòng liên hệ quản trị viên.', 503) from exc
        self.lock = Lock()

    def _decode_image(self, content: bytes) -> Image:
        if not isinstance(content, (bytes, bytearray, memoryview)) or not content:
            raise face_error('INVALID_IMAGE', 'Ảnh trống hoặc dữ liệu ảnh không hợp lệ. Vui lòng chụp lại.')
        if len(content) > MAX_IMAGE_BYTES:
            raise face_error('IMAGE_TOO_LARGE', 'Ảnh nhận diện không được vượt quá 8 MB.', 413)
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('error', self.Image.DecompressionBombWarning)
                with self.Image.open(BytesIO(content)) as source:
                    if source.format not in {'JPEG', 'PNG', 'WEBP'}:
                        raise ValueError('Unsupported image format')
                    width, height = source.size
                    if width * height > 16_000_000 or min(width, height) < 160:
                        raise ValueError('Invalid dimensions')
                    source.load()
                    frame = self.ImageOps.exif_transpose(source).convert('RGB')
                    original_size = frame.size
                    frame.thumbnail((1280, 1280))
                    frame.info['face_original_size'] = original_size
        except (OSError, ValueError, self.Image.DecompressionBombError, self.Image.DecompressionBombWarning) as exc:
            raise face_error('INVALID_IMAGE', 'Ảnh không hợp lệ. Dùng ảnh JPEG, PNG hoặc WEBP rõ nét, từ 160 px và tối đa 16 megapixel.') from exc
        return frame

    def _embedding_from_aligned(self, aligned) -> NDArray[np.float32]:
        """Caller holds the DNN lock; OpenCV owns SFace input preprocessing."""
        try:
            feature = self.recognizer.feature(aligned)
        except self.cv.error as exc:
            raise face_error('MODEL_ERROR', 'Không thể chạy mô hình nhận diện. Vui lòng thử lại.', 503) from exc
        if not isinstance(feature, self.np.ndarray) or feature.shape != (1, EMBEDDING_DIM):
            raise face_error('MODEL_ERROR', 'Mô hình trả về đặc trưng khuôn mặt không hợp lệ.', 503)
        # Copy/normalize before releasing the lock: DNN outputs may share buffers.
        return _normalize_embedding(feature[0], model_output=True).astype(self.np.float32)

    def _extract_from_frame(self, frame: Image, *, preview_only=False,
                            mode: Literal['live', 'card'] = 'live') -> NDArray[np.float32]:
        if mode not in ('live', 'card'):
            raise ValueError('Unsupported face validation mode')
        quality = CARD_FACE_QUALITY if mode == 'card' else LIVE_FACE_QUALITY
        original_width, original_height = frame.info.get('face_original_size', frame.size)
        # Includes the decoder's bounded resize as well as CARD's 2x upscale.
        scale_x = frame.width * quality.detection_scale / original_width
        scale_y = frame.height * quality.detection_scale / original_height
        diagnostics = {
            'image_size': [original_width, original_height],
            'decoded_size': list(frame.size),
            'scale': [scale_x, scale_y],
            'upscale': quality.detection_scale,
            'bbox': None, 'original_equivalent_bbox': None,
            'min_required': quality.min_face_size, 'reject_reason': None,
        }
        try:
            pixels = self.cv.cvtColor(self.np.array(frame), self.cv.COLOR_RGB2BGR)
            if quality.detection_scale != 1:
                pixels = self.cv.resize(pixels, None, fx=quality.detection_scale,
                                        fy=quality.detection_scale, interpolation=self.cv.INTER_CUBIC)
            # OpenCV DNN objects share mutable buffers between calls.
            with self.lock:
                self.detector.setInputSize((pixels.shape[1], pixels.shape[0]))
                _, faces = self.detector.detect(pixels)
                diagnostics['face_count'] = 0 if faces is None else len(faces)
                if faces is None or len(faces) == 0:
                    raise face_error('NO_FACE_DETECTED', 'Chưa phát hiện khuôn mặt trên thẻ. Vui lòng tải ảnh rõ nét, không bị che hoặc lóa.'
                                     if mode == 'card' else 'Chưa thấy khuôn mặt. Hãy nhìn vào camera và tăng ánh sáng.')
                if len(faces) != 1:
                    raise face_error('MULTIPLE_FACES_DETECTED', 'Ảnh thẻ có nhiều khuôn mặt. Vui lòng tải ảnh chỉ có một khuôn mặt.'
                                     if mode == 'card' else 'Có nhiều khuôn mặt trong ảnh. Chỉ để một người trước camera.')
                face = self.np.asarray(faces[0])
                # YuNet row: bbox[0:4], five (x,y) landmarks[4:14], score[14].
                if face.shape != (15,) or not self.np.isfinite(face).all() or min(face[2:4]) <= 0:
                    raise face_error('MODEL_ERROR', 'Mô hình trả về vị trí khuôn mặt không hợp lệ.', 503)
                diagnostics['bbox'] = [float(value) for value in face[:4]]
                original_bbox = face[:4] / self.np.array([scale_x, scale_y, scale_x, scale_y])
                diagnostics['original_equivalent_bbox'] = original_bbox.tolist()
                width_ratio = float(original_bbox[2] / original_width)
                height_ratio = float(original_bbox[3] / original_height)
                diagnostics['face_ratio'] = [width_ratio, height_ratio]
                min_face_size = quality.min_face_size
                if mode == 'card':
                    # A ratio fallback relaxes 36px to 32px, never below that
                    # data floor. Larger usable faces need no relative-size gate.
                    ratio_ok = (width_ratio >= quality.min_width_ratio
                                and height_ratio >= quality.min_height_ratio)
                    if ratio_ok:
                        min_face_size = quality.min_face_size_floor
                    diagnostics['ratio_min_required'] = [quality.min_width_ratio, quality.min_height_ratio]
                    diagnostics['ratio_fallback'] = ratio_ok
                    diagnostics['min_required'] = min_face_size
                    # Upsampling cannot restore data removed by thumbnailing.
                    decoded_face_size = min(face[2:4]) / quality.detection_scale
                    diagnostics['decoded_face_size'] = float(decoded_face_size)
                    diagnostics['decoded_min_required'] = quality.min_face_size_floor
                    too_small = (min(original_bbox[2:4]) < min_face_size
                                 or decoded_face_size < quality.min_face_size_floor)
                    if too_small:
                        diagnostics['size_reject_rule'] = ('original_min_face_size'
                            if min(original_bbox[2:4]) < min_face_size else 'decoded_data_floor')
                else:
                    # LIVE continues to use its existing 80px decoded-image gate.
                    too_small = min(face[2:4]) < quality.min_face_size
                if too_small:
                    raise face_error('FACE_TOO_SMALL', CARD_FACE_QUALITY_MESSAGE if mode == 'card'
                                     else 'Khuôn mặt quá xa. Hãy tiến gần camera và chụp lại.')
                # Preserve YuNet landmark order; alignCrop warps to 112x112 BGR.
                aligned = self.recognizer.alignCrop(pixels, face)
                if aligned is None or aligned.shape != (112, 112, 3) or aligned.dtype != self.np.uint8:
                    raise face_error('MODEL_ERROR', 'Không thể căn chỉnh khuôn mặt.', 503)
                gray = self.cv.cvtColor(aligned, self.cv.COLOR_BGR2GRAY)
                brightness = float(gray.mean())
                blur = float(self.cv.Laplacian(gray, self.cv.CV_64F).var())
                diagnostics.update(brightness=brightness, blur=blur,
                                   min_brightness=quality.min_brightness, min_blur=quality.min_blur)
                if brightness < quality.min_brightness:
                    raise face_error('FACE_TOO_DARK', 'Khuôn mặt trên thẻ quá tối. Vui lòng chụp thẻ với đủ ánh sáng.'
                                     if mode == 'card' else 'Khuôn mặt quá tối. Hãy tăng ánh sáng phía trước.')
                if blur < quality.min_blur:
                    raise face_error('FACE_TOO_BLURRY', CARD_FACE_BLUR_MESSAGE if mode == 'card'
                                     else 'Ảnh bị mờ. Hãy giữ yên khuôn mặt và chụp lại.')
                if preview_only:
                    return aligned.copy()
                return self._embedding_from_aligned(aligned)
        except HTTPException as exc:
            diagnostics['reject_reason'] = exc.detail['code']
            raise
        except self.cv.error as exc:
            diagnostics['reject_reason'] = 'MODEL_ERROR'
            raise face_error('MODEL_ERROR', 'Không thể phân tích khuôn mặt. Vui lòng thử lại.', 503) from exc
        finally:
            if mode == 'card':
                _log_card_debug(diagnostics)

    def extract_embedding(self, content: bytes, *, mode: Literal['live', 'card'] = 'live') -> NDArray[np.float32]:
        """Exactly one valid face -> finite, L2-normalized float32 vector (128,)."""
        return self._extract_from_frame(self._decode_image(content), mode=mode)

    def prepare_card(self, content: bytes) -> tuple[bytes, bytes]:
        """CARD detection/alignment/quality; preview has no embedding yet."""
        frame = self._decode_image(content)
        aligned = self._extract_from_frame(frame, preview_only=True, mode='card')
        card, face = BytesIO(), BytesIO()
        frame.save(card, format='JPEG', quality=90)
        self.Image.fromarray(self.cv.cvtColor(aligned, self.cv.COLOR_BGR2RGB)).save(face, format='JPEG', quality=90)
        return card.getvalue(), face.getvalue()

    def extract(self, content: bytes) -> tuple[NDArray[np.float32], bytes]:
        """Compatibility API for routes that also persist a sanitized JPEG."""
        frame = self._decode_image(content)
        embedding = self._extract_from_frame(frame)
        output = BytesIO()
        frame.save(output, format='JPEG', quality=90)
        return embedding, output.getvalue()

    def compare_embeddings(self, first: NDArray[np.float32], second: NDArray[np.float32]) -> float:
        return compare_embeddings(first, second)

    def similarity(self, first: NDArray[np.float32], second: NDArray[np.float32]) -> float:
        """Compatibility alias; all cosine validation lives in compare_embeddings."""
        return self.compare_embeddings(first, second)

    def verify_faces(self, reference_image: bytes, probe_image: bytes, threshold: float) -> VerificationResult:
        """1:1 verification; caller explicitly supplies its configured threshold."""
        if isinstance(threshold, bool) or not math.isfinite(threshold) or not -1 <= threshold <= 1:
            raise ValueError('Cosine threshold must be finite and between -1 and 1.')
        reference = self.extract_embedding(reference_image)
        probe = self.extract_embedding(probe_image)
        similarity = self.compare_embeddings(reference, probe)
        return {'matched': similarity >= threshold, 'similarity': similarity}


_face_engine: FaceEngine | None = None
_face_engine_lock = Lock()


def get_face_engine() -> FaceEngine:
    # Serialize the first load too; lru_cache alone can initialize concurrently.
    global _face_engine
    with _face_engine_lock:
        if _face_engine is None:
            _face_engine = FaceEngine()
        return _face_engine


def extract_embedding(image: bytes) -> NDArray[np.float32]:
    return get_face_engine().extract_embedding(image)


def verify_faces(reference_image: bytes, probe_image: bytes, threshold: float) -> VerificationResult:
    return get_face_engine().verify_faces(reference_image, probe_image, threshold)


def match_threshold() -> float:
    from app.core.config import get_settings

    # TODO(calibration): retain the configured threshold (default 0.363) only
    # provisionally; calibrate on student-card/webcam genuine and impostor pairs.
    return get_settings().FACE_MATCH_THRESHOLD
