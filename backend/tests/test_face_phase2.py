"""Synthetic metadata/pixels/scores validate tooling, never recognition accuracy."""
from __future__ import annotations

import argparse
from copy import deepcopy
import csv
import hashlib
from io import BytesIO, StringIO
import json
import math
from pathlib import Path
import random
import subprocess
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

import numpy as np
from PIL import Image

from scripts import face_dataset as dataset
from scripts import face_metrics as metrics
from scripts import prepare_face_dataset as prepare
from scripts import benchmark_face_phase2 as benchmark
from scripts.benchmark_face_verification import InvalidImage, SFaceEngine
from app.services import face_recognition as production


def records_fixture(people=10, webcams=3, ratios=(.6, .2, .2)):
    records = []
    for person in range(people):
        for image in range(webcams + 1):
            role = 'reference' if image == 0 else 'webcam'
            relative = f'private_name_{person}/{role}/{image}.png'
            records.append({
                'image_id': f'i{len(records) + 1:07d}', 'identity_id': f'p{person + 1:06d}',
                'relative_path': relative, 'role': role, 'status': 'valid',
                'sha256': hashlib.sha256(relative.encode()).hexdigest(),
                'annotations': dataset.validate_annotations({}),
            })
    return dataset.split_identities(records, ratios, seed=42)


def create_files(root, records):
    for record in records:
        path = root / record['relative_path']
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(record['relative_path'].encode())


class IdentityProtocolTests(unittest.TestCase):
    def test_identity_split_is_deterministic_order_independent_and_has_no_leakage(self):
        records = records_fixture()
        shuffled = deepcopy(records)
        random.Random(3).shuffle(shuffled)
        split = dataset.split_identities(shuffled, seed=42)
        self.assertEqual({r['image_id']: r['split'] for r in records}, {r['image_id']: r['split'] for r in split})
        sets = [{r['identity_id'] for r in records if r['split'] == s} for s in dataset.SPLITS]
        self.assertEqual([len(s) for s in sets], [6, 2, 2])
        for first, second in ((0, 1), (0, 2), (1, 2)):
            self.assertTrue(sets[first].isdisjoint(sets[second]))

    def test_calibration_test_only_split(self):
        records = records_fixture(8, ratios=(.5, .5))
        self.assertEqual({r['split'] for r in records}, {'calibration', 'test'})
        dataset.validate_records(records)

    def test_empty_small_or_invalid_split_fails(self):
        for records, ratios in (([], (.5, .5)), (records_fixture(), (.99, .01)),
                                 (records_fixture(), (.2, .2)), (records_fixture(), (math.nan, .5)),
                                 (records_fixture(), (1.0,)), (records_fixture(), (0, .5, .5))):
            with self.subTest(ratios=ratios), self.assertRaises(ValueError):
                dataset.split_identities(records, ratios)

    def test_all_pair_counts_and_reference_to_webcam_labels(self):
        records = records_fixture(8, ratios=(.5, .5))
        index = {r['image_id']: r for r in records}
        pairs = list(dataset.generate_pairs(records, 'test'))
        self.assertEqual(sum(p['genuine'] for p in pairs), 12)
        self.assertEqual(sum(not p['genuine'] for p in pairs), 36)
        self.assertEqual(len({p['pair_id'] for p in pairs}), 48)
        for pair in pairs:
            reference, probe = index[pair['reference_id']], index[pair['webcam_id']]
            self.assertEqual((reference['role'], probe['role']), ('reference', 'webcam'))
            self.assertEqual(reference['split'], probe['split'])
            self.assertEqual(pair['genuine'], reference['identity_id'] == probe['identity_id'])

    def test_sampling_is_deterministic_without_replacement_and_keeps_genuine_pairs(self):
        records = records_fixture(8, ratios=(.5, .5))
        first = list(dataset.generate_pairs(records, 'test', seed=19, max_impostors=7))
        second = list(dataset.generate_pairs(list(reversed(records)), 'test', seed=19, max_impostors=7))
        self.assertEqual(first, second)
        self.assertEqual(len(first), 19)
        self.assertEqual(sum(p['genuine'] for p in first), 12)
        self.assertNotEqual(first, list(dataset.generate_pairs(records, 'test', seed=20, max_impostors=7)))
        self.assertEqual(len({p['pair_id'] for p in first}), len(first))

    def test_sampling_boundaries_and_rejected_images_remain_in_protocol(self):
        records = records_fixture()
        rejected = next(r for r in records if r['split'] == 'train')
        rejected['status'] = 'FACE_TOO_DARK'
        a = list(dataset.generate_pairs(records, 'train'))
        b = list(dataset.generate_pairs(records, 'train', max_impostors=10**9))
        self.assertEqual(a, b)
        self.assertTrue(any(rejected['image_id'] in (r['reference_id'], r['webcam_id']) for r in a))
        for cap in (0, -1, True, 1.5):
            with self.assertRaises(ValueError):
                list(dataset.generate_pairs(records, 'test', max_impostors=cap))

    def test_pair_counts_with_unequal_webcam_counts(self):
        records = records_fixture(8, ratios=(.5, .5))
        victim = next(r for r in records if r['split'] == 'test' and r['role'] == 'webcam')
        records.remove(victim)
        pairs = list(dataset.generate_pairs(records, 'test'))
        self.assertEqual(sum(p['genuine'] for p in pairs), 11)
        self.assertEqual(sum(not p['genuine'] for p in pairs), 33)

    def test_invalid_metadata_and_leakage_are_rejected(self):
        for field, value in (('split', 'other'), ('role', 'card'), ('status', 'MODEL_ERROR'),
                             ('sha256', 'invalid'), ('annotations', {'lighting': 'student@example.com'}),
                             ('image_id', 'a real name'), ('identity_id', ''),
                             ('relative_path', '../reference/x.png'), ('annotations', [])):
            records = records_fixture()
            records[0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                dataset.validate_records(records)
        records = records_fixture()
        records[0]['split'] = 'test' if records[0]['split'] != 'test' else 'train'
        with self.assertRaisesRegex(ValueError, 'leakage'):
            dataset.validate_records(records)

    def test_duplicate_content_paths_ids_and_directory_relabeling_fail(self):
        for field in ('sha256', 'relative_path', 'image_id'):
            records = records_fixture()
            records[1][field] = records[0][field]
            with self.subTest(field=field), self.assertRaises(ValueError):
                dataset.validate_records(records)
        records = records_fixture()
        records[1]['relative_path'] = 'different_person/webcam/1.png'
        with self.assertRaisesRegex(ValueError, 'multiple source directories'):
            dataset.validate_records(records)


class DatasetValidationTests(unittest.TestCase):
    def test_discovery_rejects_empty_and_missing_domains(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, 'Empty dataset'):
                dataset.discover_dataset(root)
            (root / 'person' / 'reference').mkdir(parents=True)
            with self.assertRaises(ValueError):
                dataset.discover_dataset(root)

    def test_discovery_duplicate_images_and_unknown_annotations(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            records = records_fixture()
            create_files(root, records)
            self.assertEqual(len(dataset.discover_dataset(root)), len(records))
            with self.assertRaises(ValueError):
                dataset.discover_dataset(root, {'unknown/file.png': {}})
            (root / records[1]['relative_path']).write_bytes((root / records[0]['relative_path']).read_bytes())
            with self.assertRaisesRegex(ValueError, 'Duplicate'):
                dataset.discover_dataset(root)

    def test_outputs_cannot_overwrite_or_live_inside_dataset(self):
        with TemporaryDirectory() as directory:
            root = Path(directory) / 'dataset'
            root.mkdir()
            for target in (root, root / 'output', root.parent):
                with self.assertRaises(ValueError):
                    dataset.check_output(root, target)
            dataset.check_output(root, root.parent / 'new-output')

    def test_manifest_validation_rejects_changed_files_or_schema(self):
        with TemporaryDirectory() as directory:
            root = Path(directory) / 'data'
            records = records_fixture()
            create_files(root, records)
            path = Path(directory) / 'manifest.json'
            manifest = {'schema_version': 1, 'protocol': dataset.PROTOCOL, 'images': records}
            dataset.write_json(path, manifest)
            self.assertEqual(dataset.load_manifest(path, root)['images'], records)
            (root / records[0]['relative_path']).write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'changed'):
                dataset.load_manifest(path, root)
            dataset.write_json(path, [])
            with self.assertRaises(ValueError):
                dataset.load_manifest(path, root)

    def test_relative_path_escape_rejected(self):
        with TemporaryDirectory() as directory:
            for value in ('../reference/x.jpg', 'C:/reference/x.jpg', '/x/reference/x.jpg', 'x\\reference\\x.jpg'):
                with self.assertRaises(ValueError):
                    dataset.safe_image_path(Path(directory), value)

    def test_validator_preserves_originals_statuses_and_never_persists_vectors(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            records = records_fixture()
            create_files(root, records)
            before = {p: dataset.file_sha256(p) for p in root.rglob('*') if p.is_file()}
            engine = MagicMock()
            outcomes = [np.ones(128), InvalidImage('NO_FACE_DETECTED'), InvalidImage('MULTIPLE_FACES_DETECTED')]
            engine.extract.side_effect = outcomes + [np.ones(128)] * (len(records) - 3)
            result = prepare.validate_images(records, root, engine)
            report = dataset.dataset_summary(result)
            self.assertEqual(report['valid'], len(records) - 2)
            self.assertEqual(report['status_counts']['NO_FACE_DETECTED'], 1)
            self.assertEqual(before, {p: dataset.file_sha256(p) for p in root.rglob('*') if p.is_file()})
            self.assertNotIn('embedding', json.dumps(result))
            engine.extract.side_effect = ValueError('MODEL_ERROR')
            with self.assertRaisesRegex(ValueError, 'MODEL_ERROR'):
                prepare.validate_images(records, root, engine)

    def test_validator_calls_production_decoder_exif_and_quality_pipeline(self):
        pixels = np.random.default_rng(4).integers(40, 240, (240, 320, 3), dtype=np.uint8)
        encoded = BytesIO()
        image = Image.fromarray(pixels)
        exif = image.getexif()
        exif[274] = 6
        image.save(encoded, format='JPEG', exif=exif)
        detector, recognizer = MagicMock(), MagicMock()
        face = np.array([50, 30, 140, 140, 80, 70, 150, 70, 115, 105, 90, 140, 140, 140, .99], dtype=np.float32)
        detector.detect.return_value = (None, face[None])
        recognizer.alignCrop.return_value = pixels[:112, :112].copy()
        recognizer.feature.return_value = np.ones((1, 128), dtype=np.float32)
        with patch('cv2.FaceDetectorYN.create', return_value=detector), patch('cv2.FaceRecognizerSF.create', return_value=recognizer):
            engine = SFaceEngine(prepare.engine_arguments(1))
        with TemporaryDirectory() as directory:
            root = Path(directory)
            relative = 'anonymous/reference/image.jpg'
            path = root / relative
            path.parent.mkdir(parents=True)
            path.write_bytes(encoded.getvalue())
            record = {'relative_path': relative, 'sha256': dataset.file_sha256(path), 'status': 'pending'}
            result = prepare.validate_images([record], root, engine)
            self.assertEqual(result[0]['status'], 'valid')
            detector.setInputSize.assert_called_with((240, 320))
            np.testing.assert_array_equal(recognizer.alignCrop.call_args.args[1], face)
            detector.detect.return_value = (None, np.stack([face, face]))
            self.assertEqual(prepare.validate_images([record], root, engine)[0]['status'], 'MULTIPLE_FACES_DETECTED')


class VerificationMetricTests(unittest.TestCase):
    def test_far_frr_tar_accuracy_and_threshold_equality(self):
        result = metrics.operating_point([.3, .5, .8], [.1, .5, .7, .9], .5)
        self.assertEqual(result['false_accepts'], 3)
        self.assertEqual(result['false_rejects'], 1)
        self.assertAlmostEqual(result['far'], .75)
        self.assertAlmostEqual(result['frr'], 1 / 3)
        self.assertAlmostEqual(result['tar'], 2 / 3)
        self.assertAlmostEqual(result['accuracy'], 3 / 7)

    def test_perfect_reversed_and_tied_auc_eer(self):
        for good, bad, auc, eer in (([.8, .9], [.1, .2], 1, 0),
                                    ([.1, .2], [.8, .9], 0, 1),
                                    ([.5, .5], [.5], .5, .5)):
            with self.subTest(auc=auc):
                result = metrics.curve_summary(metrics.roc_curve(good, bad))
                self.assertAlmostEqual(result['roc_auc'], auc)
                self.assertAlmostEqual(result['eer_interpolated'], eer)

    def test_eer_interpolation_is_distinct_from_nearest_empirical_threshold(self):
        curve = metrics.roc_curve([.8, .6, .4], [.7, .3])
        result = metrics.curve_summary(curve)
        self.assertAlmostEqual(result['eer_interpolated'], .5)
        self.assertGreater(result['eer_point_gap'], 0)
        point = metrics.operating_point([.8, .6, .4], [.7, .3], result['threshold_at_nearest_eer'])
        self.assertEqual(point['far'], result['eer_point_far'])

    def test_roc_matches_independent_pairwise_auc_with_ties(self):
        rng = random.Random(51)
        for _ in range(30):
            good = [rng.choice([-.4, 0, .2, .8, 1]) for _ in range(7)]
            bad = [rng.choice([-.4, 0, .2, .8, 1]) for _ in range(9)]
            expected = sum(1 if g > b else .5 if g == b else 0 for g in good for b in bad) / (len(good) * len(bad))
            curve = metrics.roc_curve(good, bad)
            self.assertAlmostEqual(metrics.curve_summary(curve)['roc_auc'], expected)
            for row in curve:
                point = metrics.operating_point(good, bad, row['threshold'])
                self.assertAlmostEqual(point['far'], row['far'])
                self.assertAlmostEqual(point['tar'], row['tar'])

    def test_reject_all_sentinel_is_finite_and_not_a_production_threshold(self):
        choices = metrics.calibrate([1], [1], 0)
        self.assertGreater(choices['security'], 1)
        self.assertTrue(math.isfinite(choices['security']))
        self.assertEqual(metrics.operating_point([1], [1], choices['security'])['far'], 0)
        self.assertEqual(len(metrics.roc_curve([1, 1], [1])), 2)

    def test_threshold_policies_are_calibration_only_and_security_respects_budget(self):
        good, bad = [.8, .5, .4], [.7, .3, .2, .1]
        choices = metrics.calibrate(good, bad, 0)
        self.assertEqual(set(choices), {'eer', 'security', 'ux_balanced'})
        self.assertEqual(metrics.operating_point(good, bad, choices['security'])['far'], 0)
        frozen = deepcopy(choices)
        metrics.operating_point([-.3], [.9], choices['security'])
        self.assertEqual(choices, frozen)

    def test_empty_invalid_scores_and_invalid_thresholds_fail(self):
        for values in ([], [math.nan], [math.inf], [1.1], [-1.1], [True], ['.2']):
            with self.subTest(values=values), self.assertRaises(ValueError):
                metrics.roc_curve(values, [.1])
            with self.assertRaises(ValueError):
                metrics.roc_curve([.1], values)
        for value in (True, math.nan, math.inf, -1.1, 1.1):
            with self.assertRaises(ValueError):
                metrics.operating_point([.8], [.1], value)
        for target in (True, -1, 1, math.nan):
            with self.assertRaises(ValueError):
                metrics.calibrate([.8], [.1], target)

    def test_far_resolution_suppresses_underpowered_claims(self):
        result = metrics.tar_at_far([.8], [.1] * 99)
        self.assertTrue(all(r['tar'] is None for r in result))
        result = metrics.tar_at_far([.8], [.1] * 1000)
        self.assertTrue(all(r['tar'] == 1 for r in result))
        self.assertAlmostEqual(metrics.far_resolution(100)['empirical_far_step'], .01)
        self.assertIn('correlated', metrics.far_resolution(100)['warning'])

    def test_distribution_and_latency_summary(self):
        self.assertEqual(metrics.distribution([.2])['std_population'], 0)
        self.assertAlmostEqual(metrics.distribution([0, 1])['median'], .5)
        result = benchmark.latency_summary(range(1, 101))
        self.assertEqual(result, {'runs': 100, 'mean_ms': 50.5, 'median_ms': 50.5, 'p95_ms': 95})
        with self.assertRaises(ValueError):
            benchmark.latency_summary([1])


class BenchmarkProtocolTests(unittest.TestCase):
    def test_quality_rejections_stay_in_end_to_end_denominator(self):
        rows = [
            {'genuine': True, 'similarity': .8}, {'genuine': True, 'similarity': None},
            {'genuine': False, 'similarity': .1}, {'genuine': False, 'similarity': None},
        ]
        point = benchmark.point_with_coverage(rows, .5)
        self.assertEqual(point['frr'], 0)
        self.assertEqual(point['end_to_end_genuine_nonaccept_rate'], .5)
        self.assertEqual(benchmark.coverage(rows)['impostor_pairs_without_score'], 1)

    def test_gate_needs_business_requirements_and_never_starts_training(self):
        point = {'far': .01, 'end_to_end_genuine_nonaccept_rate': .05}
        self.assertEqual(metrics.decision_gate(point, 25)['status'], 'AWAITING_REQUIREMENTS')
        result = metrics.decision_gate(point, 25, max_far=.02, max_frr=.1, max_latency_ms=30)
        self.assertEqual(result['status'], 'KEEP_SFACE')
        self.assertFalse(result['training_needed'])
        result = metrics.decision_gate(point, 25, max_far=0, max_frr=.01, max_latency_ms=10)
        self.assertEqual(result['status'], 'REVIEW_EXPERIMENT')
        self.assertIsNone(result['training_needed'])

    def test_no_score_class_stops_report_instead_of_fabricating_metrics(self):
        with self.assertRaises(ValueError):
            benchmark.evaluate_split([{'genuine': True, 'similarity': None}, {'genuine': False, 'similarity': .1}], {'eer': .5})

    def test_imports_have_no_model_or_app_side_effects(self):
        code = """
import sys
before = list(sys.path)
import scripts.face_dataset, scripts.face_metrics
import scripts.prepare_face_dataset, scripts.benchmark_face_phase2
assert sys.path == before
assert 'cv2' not in sys.modules
assert 'matplotlib' not in sys.modules
assert not any(n == 'app' or n.startswith('app.') for n in sys.modules)
"""
        result = subprocess.run([sys.executable, '-c', code], cwd=Path(__file__).resolve().parents[1], capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_cli_rejects_invalid_requirements_before_inference(self):
        base = ['--dataset', 'missing', '--manifest', 'missing.json', '--output', 'out', '--security-target-far', '.01']
        for options in (['--runs', '1'], ['--warmup', '0'], ['--max-impostors', '0'],
                        ['--acceptance-max-far', '.01'], ['--security-target-far', 'nan'], ['--thresholds', 'nan']):
            with self.subTest(options=options), patch.object(benchmark, 'run_benchmark') as runner, patch('sys.stderr', new_callable=StringIO):
                with self.assertRaises(SystemExit):
                    benchmark.main(base + options)
                runner.assert_not_called()

    def test_complete_report_flow_is_private_and_thresholds_freeze_before_test(self):
        try:
            import matplotlib
        except ImportError:
            self.skipTest('Install requirements-face-experiments.txt for artifact integration test.')
        with TemporaryDirectory() as directory:
            base = Path(directory)
            root, output = base / 'dataset', base / 'output'
            records = records_fixture(8, ratios=(.5, .5))
            # One rejected webcam in test must remain visible in coverage/report.
            failed = next(r for r in records if r['split'] == 'test' and r['role'] == 'webcam')
            failed['status'] = 'FACE_TOO_BLURRY'
            create_files(root, records)
            manifest = base / 'manifest.json'
            model = {'test_fixture': True}
            dataset.write_json(manifest, {'schema_version': 1, 'protocol': dataset.PROTOCOL, 'images': records, 'model': model})
            mapping = {r['relative_path'].encode(): r for r in records}
            phases = []
            frozen = {}
            real_calibrate = metrics.calibrate

            def calibrate(good, bad, target):
                result = real_calibrate(good, bad, target)
                frozen.update(result)
                phases.append('thresholds_frozen')
                return result

            def extract(content):
                record = mapping[content]
                if record['split'] == 'test':
                    self.assertIn('thresholds_frozen', phases)
                if record['status'] != 'valid':
                    raise InvalidImage(record['status'])
                vector = np.zeros(128, dtype=np.float32)
                vector[int(record['identity_id'][1:])] = 1
                return vector

            engine = SimpleNamespace(extract=extract, compare_embeddings=production.compare_embeddings)
            args = argparse.Namespace(dataset=root, manifest=manifest, output=output, seed=42, threads=1,
                max_impostors=None, security_target_far=.01, thresholds=[.36, .5], warmup=2, runs=3,
                acceptance_max_far=None, acceptance_max_frr=None, acceptance_max_latency_ms=None)
            with patch.object(benchmark, 'SFaceEngine', return_value=engine), patch.object(benchmark, 'model_metadata', return_value=model), \
                    patch.object(benchmark, 'benchmark_cpu', return_value={'extract_embedding_encoded_image': {'p95_ms': 1}}), \
                    patch.object(benchmark, 'calibrate', side_effect=calibrate), patch('sys.stdout', new_callable=StringIO):
                summary = benchmark.run_benchmark(args)
            self.assertEqual(summary['frozen_thresholds'], frozen)
            self.assertEqual(summary['results']['test']['coverage']['genuine_pairs_without_score'], 1)
            self.assertEqual(summary['decision_gate']['status'], 'AWAITING_REQUIREMENTS')
            expected = {'roc.png', 'similarity_distribution.png', 'metrics.json', 'threshold_report.csv',
                        'benchmark_report.md', 'failure_analysis.csv', 'pair_protocol.csv', 'roc_calibration.csv', 'roc_test.csv'}
            self.assertEqual({p.name for p in output.iterdir()}, expected)
            for path in output.iterdir():
                if path.suffix == '.png':
                    with Image.open(path) as image:
                        self.assertGreater(image.width, 100)
                    continue
                text = path.read_text(encoding='utf-8')
                self.assertNotIn('private_name_', text)
                self.assertNotIn(str(root), text)
                self.assertNotIn('"embedding":', text)
            with (output / 'failure_analysis.csv').open(encoding='utf-8', newline='') as stream:
                errors = list(csv.DictReader(stream))
            self.assertTrue(any(r['quality_issue'] == 'FACE_TOO_BLURRY' for r in errors))

    def test_cpu_benchmark_uses_repeated_production_extractions_and_restores_recognizer(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            records = records_fixture(8, ratios=(.5, .5))
            create_files(root, records)
            recognizer = SimpleNamespace(feature=lambda aligned: np.ones((1, 128)))
            service = SimpleNamespace(recognizer=recognizer)
            calls = []

            def extract(content):
                calls.append(content)
                service.recognizer.feature(None)
                return np.ones(128)

            engine = SimpleNamespace(service=service, extract=extract, compare_embeddings=production.compare_embeddings)
            timing = benchmark.benchmark_cpu(records, root, engine, warmup=2, runs=5)
            self.assertEqual(len(calls), 3 * (2 + 5))
            self.assertEqual(timing['recognition_feature_only']['runs'], 5)
            self.assertEqual(timing['end_to_end_two_images_and_cosine']['runs'], 5)
            self.assertIs(service.recognizer, recognizer)
            allowed = {r['relative_path'].encode() for r in records if r['split'] == 'calibration'}
            self.assertTrue(set(calls) <= allowed)


if __name__ == '__main__':
    unittest.main()
