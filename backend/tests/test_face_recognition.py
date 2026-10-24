"""Unit tests use synthetic pixels/model outputs, not biometric accuracy claims."""
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import os
from pathlib import Path
import subprocess
import sys
from threading import Barrier
import time
from types import SimpleNamespace
from unittest import TestCase, skipUnless
from unittest.mock import MagicMock, patch

import cv2
from fastapi import HTTPException
import numpy as np
from PIL import Image

from app.services import face_recognition as service


def encode(pixels, *, image_format='PNG', orientation=None):
    output = BytesIO()
    image = Image.fromarray(pixels)
    options = {}
    if orientation is not None:
        exif = image.getexif()
        exif[274] = orientation
        options['exif'] = exif
    image.save(output, format=image_format, **options)
    return output.getvalue()


class CosineTests(TestCase):
    def setUp(self):
        self.first = np.eye(1, 128, 0, dtype=np.float32)[0]
        self.second = np.eye(1, 128, 1, dtype=np.float32)[0]

    def test_identical_opposite_and_orthogonal_vectors(self):
        for vector, expected in ((self.first, 1.0), (-self.first, -1.0), (self.second, 0.0)):
            with self.subTest(expected=expected):
                self.assertEqual(service.compare_embeddings(self.first, vector), expected)

    def test_cosine_is_scale_invariant_and_does_not_load_models_or_mutate_inputs(self):
        first = self.first * 3
        second = self.first * 6 + self.second * 8
        original = second.copy()
        with patch.object(service, 'get_face_engine') as engine:
            score = service.compare_embeddings(first, second)
        self.assertAlmostEqual(score, 0.6)
        self.assertIsInstance(score, float)
        np.testing.assert_array_equal(second, original)
        engine.assert_not_called()

    def test_cosine_is_symmetric_and_bounded(self):
        rng = np.random.default_rng(42)
        first, second = rng.normal(size=(2, 128))
        score = service.compare_embeddings(first, second)
        self.assertGreaterEqual(score, -1)
        self.assertLessEqual(score, 1)
        self.assertAlmostEqual(score, service.compare_embeddings(second, first))

    def test_extreme_finite_scales_do_not_overflow_or_underflow(self):
        for scale in (1e-300, 1e300):
            with self.subTest(scale=scale):
                vector = np.ones(128, dtype=np.float64) * scale
                self.assertAlmostEqual(service.compare_embeddings(vector, vector), 1.0)

    def test_invalid_embeddings_are_rejected_in_either_argument(self):
        invalid = (np.zeros(128), np.ones(127), np.ones(512), np.ones((1, 128)),
                   np.full(128, np.nan), np.full(128, np.inf), np.ones(128, dtype=complex), None)
        for value in invalid:
            for first, second in ((value, self.first), (self.first, value)):
                with self.subTest(shape=np.shape(value)), self.assertRaises(HTTPException) as raised:
                    service.compare_embeddings(first, second)
                self.assertEqual(raised.exception.detail['code'], 'INVALID_EMBEDDING')
                self.assertEqual(raised.exception.status_code, 422)


class FacePipelineTests(TestCase):
    def setUp(self):
        # Only model factories are mocked: decoding, color conversion, quality
        # checks, normalization and cosine execute their real implementations.
        self.detector = MagicMock()
        self.recognizer = MagicMock()
        with patch.object(Path, 'is_file', return_value=True), \
                patch('cv2.FaceDetectorYN.create', return_value=self.detector), \
                patch('cv2.FaceRecognizerSF.create', return_value=self.recognizer):
            self.engine = service.FaceEngine()
        self.face = np.array([50, 30, 140, 140, 80, 70, 150, 70, 115, 105, 90, 140, 140, 140, .99], dtype=np.float32)
        self.detector.detect.return_value = (None, self.face[None, :])
        self.pixels = np.random.default_rng(8).integers(40, 240, (240, 320, 3), dtype=np.uint8)
        self.content = encode(self.pixels)
        self.aligned = self.pixels[:112, :112].copy()
        self.recognizer.alignCrop.return_value = self.aligned
        self.raw_feature = np.arange(1, 129, dtype=np.float32)[None, :]
        self.recognizer.feature.return_value = self.raw_feature

    def assert_error(self, content, code, status=422):
        with self.assertRaises(HTTPException) as raised:
            self.engine.extract_embedding(content)
        self.assertEqual(raised.exception.detail['code'], code)
        self.assertEqual(raised.exception.status_code, status)

    def use_scaled_card_detection(self):
        def detect(pixels):
            faces = self.detector.detect.return_value[1]
            if faces is None:
                return None, None
            faces = faces.copy()
            # Model mock returns coordinates in the image it was given.
            if pixels.shape[1] == self.pixels.shape[1] * 2:
                faces[:, :14] *= 2
            return None, faces
        self.detector.detect.side_effect = detect

    def test_embedding_contract_and_sface_preprocessing(self):
        embedding = self.engine.extract_embedding(self.content)
        self.assertEqual(embedding.shape, (128,))
        self.assertEqual(embedding.dtype, np.float32)
        self.assertTrue(np.isfinite(embedding).all())
        self.assertAlmostEqual(float(np.linalg.norm(embedding)), 1.0, places=6)
        np.testing.assert_allclose(embedding, self.raw_feature[0] / np.linalg.norm(self.raw_feature), rtol=1e-6)
        self.detector.setInputSize.assert_called_once_with((320, 240))
        np.testing.assert_array_equal(self.detector.detect.call_args.args[0], self.pixels[:, :, ::-1])
        # Pass the exact YuNet row (including all five landmarks) to OpenCV.
        np.testing.assert_array_equal(self.recognizer.alignCrop.call_args.args[1], self.face)
        # No extra RGB swap, division by 255 or ArcFace normalization here.
        np.testing.assert_array_equal(self.recognizer.feature.call_args.args[0], self.aligned)
        self.recognizer.feature.assert_called_once()

    def test_embedding_owns_its_data_after_model_buffer_reuse(self):
        embedding = self.engine.extract_embedding(self.content)
        saved = embedding.copy()
        self.raw_feature[:] = -1
        self.engine.extract_embedding(self.content)
        np.testing.assert_array_equal(embedding, saved)

    def test_compatibility_extract_reuses_one_pass_and_returns_jpeg(self):
        embedding, jpeg = self.engine.extract(self.content)
        self.detector.detect.assert_called_once()
        self.recognizer.feature.assert_called_once()
        self.assertEqual(embedding.shape, (128,))
        with Image.open(BytesIO(jpeg)) as image:
            self.assertEqual(image.format, 'JPEG')
            self.assertEqual(image.size, (320, 240))

    def test_exif_orientation_is_applied_before_detection(self):
        self.engine.extract_embedding(encode(self.pixels, image_format='JPEG', orientation=6))
        self.detector.setInputSize.assert_called_once_with((240, 320))
        self.assertEqual(self.detector.detect.call_args.args[0].shape, (320, 240, 3))

    def test_empty_corrupt_wrong_type_small_and_unsupported_images(self):
        for content in (b'', b'not-an-image', None, 'not bytes',
                        encode(self.pixels[:100]), encode(self.pixels, image_format='GIF')):
            with self.subTest(kind=type(content).__name__):
                self.assert_error(content, 'INVALID_IMAGE')
        self.detector.detect.assert_not_called()

    def test_image_size_limit_is_preserved(self):
        self.assert_error(b'x' * (service.MAX_IMAGE_BYTES + 1), 'IMAGE_TOO_LARGE', 413)
        self.detector.detect.assert_not_called()

    def test_no_face_and_multiple_faces_have_explicit_errors(self):
        for faces, code in ((None, 'NO_FACE_DETECTED'), (np.empty((0, 15)), 'NO_FACE_DETECTED'),
                            (np.stack([self.face, self.face]), 'MULTIPLE_FACES_DETECTED')):
            with self.subTest(code=code):
                self.detector.detect.return_value = (None, faces)
                self.assert_error(self.content, code)
        self.recognizer.alignCrop.assert_not_called()

    def test_small_face_is_rejected_before_alignment(self):
        self.face[2] = 79
        self.assert_error(self.content, 'FACE_TOO_SMALL')
        self.recognizer.alignCrop.assert_not_called()

    def test_card_small_clear_face_passes_preview_and_confirmation_but_live_rejects(self):
        self.use_scaled_card_detection()
        for size in (32, 36, 38, 45, 50, 79):
            with self.subTest(size=size):
                self.face[2:4] = size
                card, face = self.engine.prepare_card(self.content)
                self.assertTrue(card.startswith(b'\xff\xd8'))
                self.assertTrue(face.startswith(b'\xff\xd8'))
                self.assertEqual(self.engine.extract_embedding(self.content, mode='card').shape, (128,))
                self.assert_error(self.content, 'FACE_TOO_SMALL')
        self.assertEqual(service.LIVE_MIN_FACE_SIZE, 80)
        self.face[2:4] = 80
        self.assertEqual(self.engine.extract_embedding(self.content).shape, (128,))

    def test_card_too_small_has_card_message_and_rejects_before_alignment(self):
        self.use_scaled_card_detection()
        for dimension in (2, 3):
            for operation in (self.engine.prepare_card,
                              lambda content: self.engine.extract_embedding(content, mode='card')):
                with self.subTest(dimension=dimension), self.assertRaises(HTTPException) as raised:
                    self.face[2:4] = 60
                    self.face[dimension] = 31.99
                    operation(self.content)
                self.assertEqual(raised.exception.detail['code'], 'FACE_TOO_SMALL')
                self.assertEqual(raised.exception.detail['message'],
                    'Khuôn mặt trên thẻ quá nhỏ hoặc chưa đủ rõ. Vui lòng chụp ảnh thẻ gần hơn, rõ nét hơn.')
        self.recognizer.alignCrop.assert_not_called()
        self.recognizer.feature.assert_not_called()

    def test_card_still_rejects_missing_multiple_faces_and_invalid_images(self):
        self.use_scaled_card_detection()
        self.face[2:4] = 50
        for operation in (self.engine.prepare_card,
                          lambda content: self.engine.extract_embedding(content, mode='card')):
            for faces, code in ((None, 'NO_FACE_DETECTED'),
                                (np.stack([self.face, self.face]), 'MULTIPLE_FACES_DETECTED')):
                self.detector.detect.return_value = (None, faces)
                with self.subTest(code=code), self.assertRaises(HTTPException) as raised:
                    operation(self.content)
                self.assertEqual(raised.exception.detail['code'], code)
            with self.assertRaises(HTTPException) as raised:
                operation(b'not-an-image')
            self.assertEqual(raised.exception.detail['code'], 'INVALID_IMAGE')
        self.recognizer.alignCrop.assert_not_called()
        self.recognizer.feature.assert_not_called()

    def test_card_preserves_dark_and_blur_checks_with_card_quality_message(self):
        self.use_scaled_card_detection()
        self.face[2:4] = 50
        for operation in (self.engine.prepare_card,
                          lambda content: self.engine.extract_embedding(content, mode='card')):
            for brightness, code in ((0, 'FACE_TOO_DARK'), (128, 'FACE_TOO_BLURRY')):
                self.recognizer.alignCrop.return_value = np.full((112, 112, 3), brightness, dtype=np.uint8)
                with self.subTest(code=code), self.assertRaises(HTTPException) as raised:
                    operation(self.content)
                self.assertEqual(raised.exception.detail['code'], code)
                if code == 'FACE_TOO_BLURRY':
                    self.assertEqual(raised.exception.detail['message'], service.CARD_FACE_BLUR_MESSAGE)
        self.recognizer.feature.assert_not_called()

    def test_card_detects_and_aligns_at_2x_but_evaluates_original_pixels(self):
        self.use_scaled_card_detection()
        self.face[2:4] = 38
        self.engine.extract_embedding(self.content, mode='card')
        self.detector.setInputSize.assert_called_once_with((640, 480))
        detected_pixels = self.detector.detect.call_args.args[0]
        self.assertEqual(detected_pixels.shape, (480, 640, 3))
        aligned_pixels, aligned_face = self.recognizer.alignCrop.call_args.args
        np.testing.assert_array_equal(aligned_pixels, detected_pixels)
        np.testing.assert_array_equal(aligned_face[:14], self.face[:14] * 2)
        # A detected 62px face represents only 31 original pixels, and fails.
        self.face[2:4] = 31
        with self.assertRaises(HTTPException) as raised:
            self.engine.extract_embedding(self.content, mode='card')
        self.assertEqual(raised.exception.detail['code'], 'FACE_TOO_SMALL')

    def test_card_ratio_fallback_has_a_floor_and_does_not_block_large_faces(self):
        self.pixels = np.zeros((960, 1280, 3), dtype=np.uint8)
        self.content = encode(self.pixels)
        self.use_scaled_card_detection()
        self.face[2:4] = 33  # Below 36px and occupies too little of this card.
        with self.assertRaises(HTTPException) as raised:
            self.engine.extract_embedding(self.content, mode='card')
        self.assertEqual(raised.exception.detail['code'], 'FACE_TOO_SMALL')
        self.face[2:4] = 38  # Enough absolute data even with small card ratios.
        self.assertEqual(self.engine.extract_embedding(self.content, mode='card').shape, (128,))

    def test_card_accounts_for_thumbnail_and_cannot_invent_missing_pixel_data(self):
        content = encode(np.zeros((1920, 2560, 3), dtype=np.uint8))
        frame = self.engine._decode_image(content)
        self.assertEqual(frame.size, (1280, 960))
        self.assertEqual(frame.info['face_original_size'], (2560, 1920))
        self.face[2:4] = 76  # Detector sees 76px at 2x; original is also 76px.
        with patch.object(service, '_log_card_debug') as debug:
            self.engine.extract_embedding(content, mode='card')
        record = debug.call_args.args[0]
        self.assertEqual(record['scale'], [1, 1])
        self.assertEqual(record['original_equivalent_bbox'][2:4], [76, 76])
        self.assertEqual(record['decoded_face_size'], 38)
        self.face[2:4] = 60  # Original 60px, but only 30px survived decoding.
        with patch.object(service, '_log_card_debug') as debug, self.assertRaises(HTTPException) as raised:
            self.engine.extract_embedding(content, mode='card')
        self.assertEqual(raised.exception.detail['code'], 'FACE_TOO_SMALL')
        self.assertEqual(debug.call_args.args[0]['size_reject_rule'], 'decoded_data_floor')

    def test_card_quality_is_separate_and_live_remains_strict(self):
        self.assertEqual((service.LIVE_FACE_QUALITY.min_face_size,
                          service.LIVE_FACE_QUALITY.min_brightness,
                          service.LIVE_FACE_QUALITY.min_blur,
                          service.LIVE_FACE_QUALITY.detection_scale), (80, 35, 15, 1))
        # Exercise real gray/Laplacian computation in both modes.
        gray = np.full((112, 112), 30, dtype=np.uint8)
        gray[:, ::2] += 2  # Laplacian variance 16; brightness 31.
        self.recognizer.alignCrop.return_value = np.repeat(gray[:, :, None], 3, axis=2)
        self.engine.extract_embedding(self.content, mode='card')
        self.assert_error(self.content, 'FACE_TOO_DARK')
        # Bright crop with Laplacian variance between CARD=8 and LIVE=15.
        gray[:] = 128
        gray[:84, ::2] += 2
        self.recognizer.alignCrop.return_value = np.repeat(gray[:, :, None], 3, axis=2)
        self.engine.extract_embedding(self.content, mode='card')
        self.assert_error(self.content, 'FACE_TOO_BLURRY')

    def test_card_debug_reports_geometry_and_each_failure_code(self):
        self.use_scaled_card_detection()
        for faces, code in ((self.face[None, :], None), (None, 'NO_FACE_DETECTED'),
                            (np.stack([self.face, self.face]), 'MULTIPLE_FACES_DETECTED')):
            self.detector.detect.return_value = (None, faces)
            with patch.object(service, '_log_card_debug') as debug:
                if code:
                    with self.assertRaises(HTTPException):
                        self.engine.extract_embedding(self.content, mode='card')
                else:
                    self.engine.extract_embedding(self.content, mode='card')
            record = debug.call_args.args[0]
            self.assertEqual(record['reject_reason'], code)
            for key in ('image_size', 'scale', 'bbox', 'original_equivalent_bbox', 'min_required'):
                self.assertIn(key, record)
            self.assertNotIn('embedding', record)
            self.assertNotIn('image', record)
        with patch.object(service, '_log_card_debug') as debug:
            self.detector.detect.return_value = (None, self.face[None, :])
            self.engine.extract_embedding(self.content)
        debug.assert_not_called()

    def test_exam_verification_retains_live_size_gate(self):
        self.face[2:4] = 50
        with self.assertRaises(HTTPException) as raised:
            self.engine.verify_faces(self.content, self.content, .363)
        self.assertEqual(raised.exception.detail['code'], 'FACE_TOO_SMALL')
        self.assertEqual(raised.exception.detail['message'], 'Khuôn mặt quá xa. Hãy tiến gần camera và chụp lại.')
        self.recognizer.feature.assert_not_called()

    def test_invalid_landmarks_and_alignment_are_model_errors(self):
        for face in (self.face[:14], np.full(15, np.nan)):
            self.detector.detect.return_value = (None, face[None, :])
            self.assert_error(self.content, 'MODEL_ERROR', 503)
        self.detector.detect.return_value = (None, self.face[None, :])
        for aligned in (None, np.zeros((224, 224, 3), dtype=np.uint8), self.aligned.astype(np.float32)):
            self.recognizer.alignCrop.return_value = aligned
            self.assert_error(self.content, 'MODEL_ERROR', 503)
        self.recognizer.feature.assert_not_called()

    def test_dark_and_blurry_quality_gates_are_preserved(self):
        for brightness, code in ((0, 'FACE_TOO_DARK'), (128, 'FACE_TOO_BLURRY')):
            with self.subTest(code=code):
                self.recognizer.alignCrop.return_value = np.full((112, 112, 3), brightness, dtype=np.uint8)
                self.assert_error(self.content, code)
        self.recognizer.feature.assert_not_called()

    def test_wrong_dimension_zero_nan_and_infinite_model_outputs_fail_closed(self):
        for feature in (np.ones((1, 127)), np.ones((1, 512)), np.ones((2, 64)),
                        np.ones((128, 1)), np.zeros((1, 128)),
                        np.full((1, 128), np.nan), np.full((1, 128), np.inf), None):
            with self.subTest(shape=np.shape(feature)):
                self.recognizer.feature.return_value = feature
                self.assert_error(self.content, 'MODEL_ERROR', 503)

    def test_opencv_failures_map_to_model_error_and_release_lock(self):
        for operation in (self.detector.detect, self.recognizer.alignCrop, self.recognizer.feature):
            with self.subTest(operation=operation):
                operation.side_effect = cv2.error('Synthetic inference failure')
                self.assert_error(self.content, 'MODEL_ERROR', 503)
                self.assertFalse(self.engine.lock.locked())
                operation.side_effect = None
        self.assertEqual(self.engine.extract_embedding(self.content).shape, (128,))

    def test_verify_uses_supplied_threshold_including_equality(self):
        first, second = np.eye(2, 128, dtype=np.float32)
        for threshold, expected in ((-0.1, True), (0.0, True), (np.nextafter(0.0, 1.0), False)):
            with self.subTest(threshold=threshold), patch.object(self.engine, 'extract_embedding', side_effect=[first, second]) as extract:
                result = self.engine.verify_faces(b'reference', b'probe', threshold)
            self.assertEqual(result, {'matched': expected, 'similarity': 0.0})
            self.assertEqual([call.args for call in extract.call_args_list], [(b'reference',), (b'probe',)])

    def test_invalid_threshold_fails_before_inference(self):
        for threshold in (float('nan'), float('inf'), -1.1, 1.1, True):
            with self.subTest(threshold=threshold), self.assertRaises(ValueError):
                self.engine.verify_faces(self.content, self.content, threshold)
        self.detector.detect.assert_not_called()

    def test_verify_does_not_turn_an_extraction_error_into_a_match(self):
        self.detector.detect.return_value = (None, None)
        with self.assertRaises(HTTPException) as raised:
            self.engine.verify_faces(self.content, self.content, .363)
        self.assertEqual(raised.exception.detail['code'], 'NO_FACE_DETECTED')


@skipUnless(os.environ.get('STUDENT_CARD_TEST_IMAGE'), 'Opt-in private card image/model regression')
class RealCardFaceTests(TestCase):
    def test_private_card_passes_preview_confirmation_and_keeps_live_gate(self):
        content = Path(os.environ['STUDENT_CARD_TEST_IMAGE']).read_bytes()
        engine = service.FaceEngine()
        card, face = engine.prepare_card(content)
        with Image.open(BytesIO(card)) as image:
            self.assertEqual(image.format, 'JPEG')
        with Image.open(BytesIO(face)) as image:
            self.assertEqual(image.size, (112, 112))
        embedding = engine.extract_embedding(content, mode='card')
        self.assertEqual(embedding.shape, (128,))
        self.assertEqual(embedding.dtype, np.float32)
        self.assertTrue(np.isfinite(embedding).all())
        self.assertAlmostEqual(float(np.linalg.norm(embedding)), 1, places=6)
        # This regression fixture has a clear ~69px portrait, below LIVE=80.
        with self.assertRaises(HTTPException) as raised:
            engine.extract_embedding(content)
        self.assertEqual(raised.exception.detail['code'], 'FACE_TOO_SMALL')


class ModelLifecycleTests(TestCase):
    def test_card_debug_is_opt_in_and_never_logs_in_production(self):
        for environment, enabled, expected in (('development', True, True), ('test', True, True),
                ('local', True, True), ('production', True, False), ('prod', True, False),
                ('staging', True, False), ('development', False, False)):
            with self.subTest(environment=environment, enabled=enabled), \
                    patch('app.core.config.get_settings', return_value=SimpleNamespace(
                        ENVIRONMENT=environment, CARD_FACE_DEBUG=enabled)), \
                    patch.object(service.logger, 'info') as log:
                service._log_card_debug({'image_size': [720, 454], 'reject_reason': None})
            self.assertEqual(log.called, expected)

    def test_missing_and_unloadable_models_have_model_error(self):
        with patch.object(Path, 'is_file', return_value=False), self.assertRaises(HTTPException) as raised:
            service.FaceEngine()
        self.assertEqual((raised.exception.status_code, raised.exception.detail['code']), (503, 'MODEL_ERROR'))
        for factory in ('cv2.FaceDetectorYN.create', 'cv2.FaceRecognizerSF.create'):
            with patch.object(Path, 'is_file', return_value=True), \
                    patch('cv2.FaceDetectorYN.create'), patch('cv2.FaceRecognizerSF.create'), \
                    patch(factory, side_effect=cv2.error('Cannot load model')), self.assertRaises(HTTPException) as raised:
                service.FaceEngine()
            self.assertEqual((raised.exception.status_code, raised.exception.detail['code']), (503, 'MODEL_ERROR'))

    def test_public_functions_use_the_cached_engine(self):
        engine = MagicMock()
        with patch.object(service, '_face_engine', None), \
                patch.object(service, 'FaceEngine', return_value=engine) as constructor:
            service.extract_embedding(b'image')
            service.verify_faces(b'reference', b'probe', .363)
        constructor.assert_called_once_with()
        engine.extract_embedding.assert_called_once_with(b'image')
        engine.verify_faces.assert_called_once_with(b'reference', b'probe', .363)

    def test_concurrent_first_requests_share_one_engine(self):
        start = Barrier(4)

        def construct():
            time.sleep(.05)  # Allow concurrent callers during a slow model load.
            return MagicMock()

        def get_engine(_):
            start.wait(timeout=5)
            return service.get_face_engine()

        with patch.object(service, '_face_engine', None), \
                patch.object(service, 'FaceEngine', side_effect=construct) as constructor:
            with ThreadPoolExecutor(max_workers=4) as pool:
                engines = list(pool.map(get_engine, range(4)))
        constructor.assert_called_once_with()
        self.assertTrue(all(engine is engines[0] for engine in engines))

    def test_failed_initialization_can_be_retried(self):
        engine = MagicMock()
        with patch.object(service, '_face_engine', None), \
                patch.object(service, 'FaceEngine', side_effect=[service.face_error('MODEL_ERROR', 'Unavailable', 503), engine]):
            with self.assertRaises(HTTPException):
                service.get_face_engine()
            self.assertIs(service.get_face_engine(), engine)

    def test_threshold_remains_configured(self):
        with patch('app.core.config.get_settings', return_value=SimpleNamespace(FACE_MATCH_THRESHOLD=.363)):
            self.assertEqual(service.match_threshold(), .363)


class SFaceBenchmarkReuseTests(TestCase):
    def test_import_has_no_production_or_opencv_side_effects(self):
        script = """
import sys
before = list(sys.path)
import scripts.benchmark_face_verification
assert sys.path == before
assert not any(name == 'app' or name.startswith('app.') for name in sys.modules)
assert 'cv2' not in sys.modules
"""
        result = subprocess.run([sys.executable, '-c', script], cwd=Path(__file__).resolve().parents[1],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_benchmark_reuses_service_and_preserves_error_categories(self):
        from scripts.benchmark_face_verification import InvalidImage, SFaceEngine

        args = SimpleNamespace(detector=Path('detector.onnx'), recognizer=Path('sface.onnx'), threads=1)
        engine = MagicMock()
        with patch.object(service, 'FaceEngine', return_value=engine) as constructor:
            adapter = SFaceEngine(args)
        constructor.assert_called_once_with(detector_path=args.detector, recognizer_path=args.recognizer)
        adapter.extract(b'image')
        engine.extract_embedding.assert_called_once_with(b'image')
        adapter.compare_embeddings('reference', 'probe')
        engine.compare_embeddings.assert_called_once_with('reference', 'probe')
        engine.extract_embedding.side_effect = service.face_error('NO_FACE_DETECTED', 'No face')
        with self.assertRaises(InvalidImage):
            adapter.extract(b'image')
        engine.extract_embedding.side_effect = service.face_error('MODEL_ERROR', 'Broken model', 503)
        with self.assertRaises(ValueError) as raised:
            adapter.extract(b'image')
        self.assertNotIsInstance(raised.exception, InvalidImage)
