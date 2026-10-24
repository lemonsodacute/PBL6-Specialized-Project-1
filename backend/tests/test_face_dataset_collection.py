"""Collection/storage contracts with synthetic pixels; no webcam hardware tests."""
from io import BytesIO, StringIO
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

import numpy as np
from PIL import Image

from scripts import collect_face_dataset as collect
from scripts import validate_face_dataset as validate
from scripts.face_dataset import discover_dataset, split_identities, validate_records


def info():
    return {'width': 320, 'height': 240, 'face_bbox_size': [140.0, 140.0]}


def encoded(seed=7, orientation=None):
    pixels = np.random.default_rng(seed).integers(40, 240, (240, 320, 3), dtype=np.uint8)
    source = Image.fromarray(pixels)
    stream = BytesIO()
    options = {}
    if orientation is not None:
        exif = source.getexif()
        exif[274] = orientation
        exif[315] = 'Private Source Author'
        options['exif'] = exif
    source.save(stream, format='JPEG', **options)
    return stream.getvalue()


class CollectionStoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'dataset'
        self.store = collect.DatasetStore(self.root)

    def test_anonymous_id_validation(self):
        for person in ('person_001', 'person_050', 'person_0001', 'person_100000'):
            self.assertEqual(collect.validate_person_id(person), person)
        for person in ('Student001', 'person_0', 'person_000', 'person_12', 'person_1000000',
                       'person_001/../name', '../person_001', 'person_001\\webcam', 'person_001:ads',
                       'person_001 ', 'person_００１', 'name@example.com', '', None, 3):
            with self.subTest(person=person), self.assertRaises(collect.CollectionError):
                collect.validate_person_id(person)

    def test_folder_creation_contains_only_reference_and_webcam(self):
        self.store.ensure_person('person_001')
        self.store.ensure_person('person_001')
        self.assertEqual({p.name for p in (self.root / 'person_001').iterdir()}, {'reference', 'webcam'})
        self.assertFalse((self.root / 'metadata.json').exists())

    def test_invalid_person_never_creates_directory(self):
        with self.assertRaises(collect.CollectionError):
            self.store.ensure_person('../escape')
        self.assertFalse(self.root.exists())

    def test_safe_fixed_filenames(self):
        self.assertEqual(collect.image_relative_path('person_001', 'reference', 'reference').as_posix(),
                         'person_001/reference/reference.jpg')
        for kind, label in (('webcam', '../x'), ('webcam', 'name.jpg'), ('reference', 'second'), ('other', 'front_01')):
            with self.assertRaises(collect.CollectionError):
                collect.image_relative_path('person_001', kind, label)
        with self.assertRaises(collect.CollectionError):
            self.store.checked_path('../outside.jpg')

    def test_reference_duplicate_and_no_overwrite_without_confirmation(self):
        row = self.store.save('person_001', 'reference', 'reference', b'original', info())
        path = self.root / row['filename']
        metadata = (self.root / 'metadata.json').read_bytes()
        for confirm in (None, lambda _: False, lambda _: 'yes'):
            with self.assertRaisesRegex(collect.CollectionError, 'confirmation required'):
                self.store.save('person_001', 'reference', 'reference', b'replacement', info(), confirm_replace=confirm)
            self.assertEqual(path.read_bytes(), b'original')
            self.assertEqual((self.root / 'metadata.json').read_bytes(), metadata)
        (path.parent / 'other.jpg').write_bytes(b'other')
        with self.assertRaisesRegex(collect.CollectionError, 'Duplicate'):
            self.store.save('person_001', 'reference', 'reference', b'replacement', info(), confirm_replace=lambda _: True)
        self.assertEqual(path.read_bytes(), b'original')

    def test_confirmed_replacement_updates_one_metadata_row(self):
        self.store.save('person_001', 'webcam', 'left', b'old', info())
        asked = []

        def confirm(relative):
            asked.append(relative)
            return True

        row = self.store.save('person_001', 'webcam', 'left', b'new', info(), confirm_replace=confirm)
        self.assertEqual(asked, ['person_001/webcam/left.jpg'])
        self.assertEqual((self.root / row['filename']).read_bytes(), b'new')
        self.assertEqual(self.store.metadata()['images'], [row])
        self.assertFalse((self.root / '.collection.lock').exists())

    def test_metadata_contains_only_anonymous_scalars_no_source_path_or_vector(self):
        row = self.store.save('person_001', 'reference', 'reference', b'jpeg', info())
        self.assertEqual(row['person_id'], 'person_001')
        self.assertEqual(row['type'], 'reference')
        self.assertEqual(row['capture_label'], 'reference')
        self.assertEqual(row['face_bbox_size'], [140, 140])
        self.assertIn('+00:00', row['captured_at'])
        self.assertEqual(len(row['sha256']), 64)
        raw = (self.root / 'metadata.json').read_text()
        self.assertNotIn('embedding', raw)
        self.assertNotIn(str(self.root), raw)
        self.assertFalse((self.root / 'person_001' / 'metadata.json').exists())

    def test_invalid_metadata_prevents_image_write(self):
        for bad in ({**info(), 'embedding': [1, 2]}, {**info(), 'width': True},
                    {**info(), 'face_bbox_size': [float('nan'), 100]}):
            with self.assertRaises(collect.CollectionError):
                self.store.save('person_001', 'reference', 'reference', b'x', bad)
        self.assertFalse(self.root.exists())

    def test_corrupt_metadata_is_not_overwritten(self):
        self.store.ensure_person('person_001')
        path = self.root / 'metadata.json'
        path.write_text('{broken', encoding='utf-8')
        with self.assertRaises(ValueError):
            self.store.save('person_001', 'webcam', 'left', b'new', info())
        self.assertEqual(path.read_text(), '{broken')
        self.assertFalse((self.root / 'person_001/webcam/left.jpg').exists())

    def test_write_failure_restores_previous_image_and_metadata(self):
        row = self.store.save('person_001', 'reference', 'reference', b'old', info())
        original_write = self.store._atomic_write
        before = (self.root / 'metadata.json').read_bytes()

        def fail_metadata(target, content):
            if target.name == 'metadata.json':
                raise OSError('Synthetic disk failure')
            original_write(target, content)

        with patch.object(self.store, '_atomic_write', side_effect=fail_metadata), self.assertRaises(OSError):
            self.store.save('person_001', 'reference', 'reference', b'new', info(), confirm_replace=lambda _: True)
        self.assertEqual((self.root / row['filename']).read_bytes(), b'old')
        self.assertEqual((self.root / 'metadata.json').read_bytes(), before)
        with patch.object(self.store, '_atomic_write', side_effect=fail_metadata), self.assertRaises(OSError):
            self.store.save('person_001', 'webcam', 'front_01', b'new', info())
        self.assertFalse((self.root / 'person_001/webcam/front_01.jpg').exists())

    def test_lock_prevents_competing_collectors_from_writing(self):
        with self.store.locked():
            with self.assertRaisesRegex(collect.CollectionError, 'locked'):
                self.store.save('person_001', 'reference', 'reference', b'new', info())
        self.assertFalse((self.root / '.collection.lock').exists())

    def test_collected_structure_is_compatible_with_existing_phase2_validator(self):
        for person in range(1, 5):
            identity = f'person_{person:03d}'
            self.store.save(identity, 'reference', 'reference', f'ref-{person}'.encode(), info())
            for label in collect.CAPTURE_LABELS:
                self.store.save(identity, 'webcam', label, f'{person}-{label}'.encode(), info())
        records = discover_dataset(self.root)
        self.assertEqual(len(records), 24)
        split = split_identities(records, (.5, .5), seed=42)
        validate_records(split, allow_pending=True)
        self.assertEqual(sum(r['role'] == 'reference' for r in split), 4)
        self.assertEqual(sum(r['role'] == 'webcam' for r in split), 20)


class CaptureSessionTests(unittest.TestCase):
    def test_capture_retake_and_save_require_no_similarity(self):
        with TemporaryDirectory() as directory:
            store = collect.DatasetStore(Path(directory) / 'data')
            validator = MagicMock()
            validator.prepare_frame.return_value = (b'jpeg', info())
            session = collect.CaptureSession(store, 'person_001', validator)
            session.capture('frame')
            self.assertFalse(store.root.exists())
            session.retake()
            self.assertIsNone(session.pending)
            session.capture('frame')
            row = session.save()
            self.assertEqual(row['filename'], 'person_001/webcam/front_01.jpg')
            self.assertEqual(session.label, 'front_02')
            session.retake()
            self.assertEqual(session.label, 'front_01')
            self.assertTrue((store.root / row['filename']).exists())
            session.capture('frame')
            with self.assertRaises(collect.CollectionError):
                session.save()
            session.save(lambda _: True)
            validator.compare_embeddings.assert_not_called()

    def test_invalid_capture_clears_pending_and_writes_nothing(self):
        with TemporaryDirectory() as directory:
            store = collect.DatasetStore(Path(directory) / 'data')
            validator = MagicMock()
            validator.prepare_frame.side_effect = collect.ImageRejected('NO_FACE_DETECTED', 'No face')
            session = collect.CaptureSession(store, 'person_001', validator)
            with self.assertRaises(collect.ImageRejected):
                session.capture(None)
            self.assertIsNone(session.pending)
            with self.assertRaises(collect.CollectionError):
                session.save()
            self.assertFalse(store.root.exists())

    def test_resume_skips_saved_labels(self):
        with TemporaryDirectory() as directory:
            store = collect.DatasetStore(directory)
            store.save('person_001', 'webcam', 'front_01', b'one', info())
            session = collect.CaptureSession(store, 'person_001', MagicMock())
            self.assertEqual(session.label, 'front_02')
            session.select('low_light')
            self.assertEqual(session.label, 'low_light')


class ProductionQualityReuseTests(unittest.TestCase):
    def setUp(self):
        self.detector, self.recognizer = MagicMock(), MagicMock()
        with patch.object(Path, 'is_file', return_value=True), \
                patch('cv2.FaceDetectorYN.create', return_value=self.detector), \
                patch('cv2.FaceRecognizerSF.create', return_value=self.recognizer):
            self.validator = collect.QualityValidator()
        self.face = np.array([50, 30, 140, 140, 80, 70, 150, 70, 115, 105, 90, 140, 140, 140, .99], dtype=np.float32)
        self.detector.detect.return_value = (None, self.face[None])
        self.recognizer.alignCrop.return_value = np.random.default_rng(5).integers(40, 240, (112, 112, 3), dtype=np.uint8)
        self.recognizer.feature.return_value = np.ones((1, 128), dtype=np.float32)

    def test_exif_corrected_reference_exact_saved_jpeg_is_validated_and_metadata_stripped(self):
        with patch.object(self.validator.engine, 'extract_embedding', wraps=self.validator.engine.extract_embedding) as extract, \
                patch.object(self.validator.engine, 'compare_embeddings') as compare:
            jpeg, metadata = self.validator.prepare(encoded(orientation=6))
        extract.assert_called_once_with(jpeg)
        compare.assert_not_called()
        self.assertEqual(metadata, {'width': 240, 'height': 320, 'face_bbox_size': [140, 140]})
        with Image.open(BytesIO(jpeg)) as image:
            self.assertEqual(image.format, 'JPEG')
            self.assertEqual(image.size, (240, 320))
            self.assertFalse(image.getexif())

    def test_capture_reuses_production_face_count_and_size_gates(self):
        frame = np.full((240, 320, 3), 100, dtype=np.uint8)
        small = self.face.copy()
        small[2] = 79
        for faces, code in ((None, 'NO_FACE_DETECTED'), (np.stack([self.face, self.face]), 'MULTIPLE_FACES_DETECTED'),
                            (small[None], 'FACE_TOO_SMALL')):
            self.detector.detect.return_value = (None, faces)
            with self.subTest(code=code), self.assertRaises(collect.ImageRejected) as raised:
                self.validator.prepare_frame(frame)
            self.assertEqual(raised.exception.code, code)

    def test_invalid_image_and_frame_rejections(self):
        for content in (b'', b'not an image'):
            with self.assertRaises(collect.ImageRejected) as raised:
                self.validator.prepare(content)
            self.assertEqual(raised.exception.code, 'INVALID_IMAGE')
        for frame in (None, np.zeros((240, 320)), np.zeros((240, 320, 3), dtype=np.float32)):
            with self.assertRaises(collect.ImageRejected):
                self.validator.prepare_frame(frame)

    def test_reference_only_import_does_not_open_camera_and_preserves_source(self):
        with TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / 'Private Source Name.jpg'
            content = encoded(orientation=6)
            source.write_bytes(content)
            with patch.object(collect, 'QualityValidator', return_value=self.validator), \
                    patch.object(collect, 'open_camera') as camera, patch('sys.stdout', new_callable=StringIO):
                collect.main(['--person', 'person_001', '--dataset', str(base / 'data'), '--reference', str(source), '--reference-only', '--consent'])
            camera.assert_not_called()
            self.assertEqual(source.read_bytes(), content)
            self.assertNotIn('Private Source Name', (base / 'data/metadata.json').read_text())
            self.assertTrue((base / 'data/person_001/reference/reference.jpg').is_file())

    def test_model_failure_is_fatal_not_a_silently_rejected_image(self):
        from app.services.face_recognition import face_error
        with patch.object(self.validator.engine, 'extract_embedding', side_effect=face_error('MODEL_ERROR', 'Unavailable', 503)):
            with self.assertRaises(collect.CollectionError) as raised:
                self.validator.inspect(encoded())
        self.assertNotIsInstance(raised.exception, collect.ImageRejected)


class CollectionSummaryTests(unittest.TestCase):
    def test_missing_or_empty_dataset_does_not_load_model(self):
        with TemporaryDirectory() as directory:
            factory = MagicMock()
            for root in (Path(directory), Path(directory) / 'missing'):
                result = validate.summarize_dataset(root, factory)
                self.assertEqual(result['status'], 'DATASET_INSUFFICIENT')
                self.assertEqual(result['identities'], 0)
            factory.assert_not_called()

    def test_summary_incomplete_duplicate_rejected_and_metadata_mismatch(self):
        with TemporaryDirectory() as directory:
            store = collect.DatasetStore(directory)
            store.save('person_001', 'reference', 'reference', b'reference', info())
            store.save('person_001', 'webcam', 'front_01', b'probe', info())
            (Path(directory) / 'person_001/webcam/broken.jpg').write_bytes(b'broken')
            (Path(directory) / 'person_001/webcam/duplicate.jpg').write_bytes(b'probe')
            validator = MagicMock()
            validator.read.side_effect = lambda p: p.read_bytes()
            validator.inspect.side_effect = lambda b: (_ for _ in ()).throw(collect.ImageRejected('INVALID_IMAGE', 'Invalid')) if b == b'broken' else info()
            before = {p: p.read_bytes() for p in Path(directory).rglob('*') if p.is_file()}
            result = validate.summarize_dataset(directory, lambda: validator)
            self.assertEqual(result['reference_images'], 1)
            self.assertEqual(result['webcam_images'], 3)
            self.assertEqual(result['valid'], 3)
            self.assertEqual(result['rejected'], 1)
            self.assertEqual(result['rejection_counts']['INVALID_IMAGE'], 1)
            self.assertEqual(result['duplicate_image_contents'], 1)
            self.assertEqual(result['incomplete_identities'], 1)
            self.assertEqual(result['images_without_metadata'], 2)
            self.assertEqual(result['status'], 'COLLECTION_NEEDS_REVIEW')
            self.assertEqual(before, {p: p.read_bytes() for p in Path(directory).rglob('*') if p.is_file()})
            (Path(directory) / 'person_001/reference/reference.jpg').write_bytes(b'changed')
            self.assertEqual(validate.summarize_dataset(directory, lambda: validator)['stale_metadata_rows'], 1)

    def test_complete_ten_identities_means_ready_for_preparation_not_accuracy(self):
        with TemporaryDirectory() as directory:
            store = collect.DatasetStore(directory)
            for number in range(1, 11):
                person = f'person_{number:03d}'
                store.save(person, 'reference', 'reference', f'ref-{number}'.encode(), info())
                for label in collect.CAPTURE_LABELS[:3]:
                    store.save(person, 'webcam', label, f'{number}-{label}'.encode(), info())
            validator = SimpleNamespace(read=lambda p: p.read_bytes(), inspect=lambda b: info())
            result = validate.summarize_dataset(directory, lambda: validator)
            self.assertEqual(result['complete_identities'], 10)
            self.assertEqual(result['status'], 'READY_FOR_PREPARATION')
            self.assertEqual(result['average_webcam_images_per_identity'], 3)
            self.assertIn('not proof', result['statistical_note'])

    def test_imports_have_no_camera_gui_model_side_effects(self):
        code = """
import sys
before=list(sys.path)
import scripts.collect_face_dataset, scripts.validate_face_dataset
assert sys.path == before
assert 'cv2' not in sys.modules
assert 'tkinter' not in sys.modules
assert not any(n == 'app' or n.startswith('app.') for n in sys.modules)
"""
        result = subprocess.run([sys.executable, '-c', code], cwd=Path(__file__).resolve().parents[1], capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_consent_decline_never_creates_dataset_or_opens_camera(self):
        with TemporaryDirectory() as directory, patch('builtins.input', return_value='NO'), \
                patch.object(collect, 'QualityValidator') as validator, patch.object(collect, 'open_camera') as camera:
            root = Path(directory) / 'dataset'
            with self.assertRaises(collect.CollectionError):
                collect.main(['--person', 'person_001', '--dataset', str(root)])
            self.assertFalse(root.exists())
            validator.assert_not_called()
            camera.assert_not_called()


if __name__ == '__main__':
    unittest.main()
