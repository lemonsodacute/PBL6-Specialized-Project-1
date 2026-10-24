"""Offline SFace baseline: frozen identity protocol, calibration and local reports.

No database, API, uploads, training, downloads or production configuration writes.
Run prepare_face_dataset.py first. Only a NEW --output directory is written.
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import random
import shutil
import statistics
import subprocess
import sys
import time

if __name__ == '__main__' and __package__ is None:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.benchmark_face_verification import InvalidImage, SFaceEngine, memory_mb
from scripts.face_dataset import (
    IMAGE_ERRORS, PROTOCOL, check_output, dataset_summary, file_sha256,
    generate_pairs, load_manifest, read_verified_image, write_json,
)
from scripts.face_metrics import (
    calibrate, curve_summary, decision_gate, distribution, far_resolution,
    operating_point, roc_curve, tar_at_far,
)
from scripts.prepare_face_dataset import engine_arguments, model_metadata

LIMITATIONS = [
    'Awaiting dataset coverage review: identity, demographic, device and lighting diversity are not guaranteed by pair count.',
    'Pairs share people/images; empirical FAR and IID bounds do not establish population confidence.',
    'Verification metrics condition on successful extraction. Planned-pair coverage and end-to-end nonaccept rates include quality failures.',
    'One trusted reference vs one webcam differs from the live three-webcam median policy; do not transfer thresholds directly.',
    'Accuracy depends on the genuine/impostor sampling ratio. Balanced accuracy is reported separately.',
    'Test ROC/AUC/EER/TAR-at-FAR are descriptive only. All operational thresholds were frozen on calibration identities.',
    'CPU timings exclude HTTP, database, disk I/O, concurrent requests and server contention.',
    'No training or production deployment is performed by this script.',
]


def latency_summary(values) -> dict:
    if len(values) < 2 or any(not math.isfinite(v) or v < 0 for v in values):
        raise ValueError('Latency needs at least two finite nonnegative measurements.')
    values = sorted(values)
    return {'runs': len(values), 'mean_ms': statistics.mean(values), 'median_ms': statistics.median(values),
            'p95_ms': values[math.ceil(.95 * len(values)) - 1]}


class TimedRecognizer:
    """Offline timing wrapper; all pixels and calls pass unchanged to OpenCV."""
    def __init__(self, recognizer):
        self.recognizer = recognizer
        self.durations = []

    def alignCrop(self, pixels, face):
        return self.recognizer.alignCrop(pixels, face)

    def feature(self, aligned):
        start = time.perf_counter()
        result = self.recognizer.feature(aligned)
        self.durations.append((time.perf_counter() - start) * 1000)
        return result


def extract_split(records, root, engine, split):
    embeddings, errors = {}, {}
    for record in records:
        if record['split'] != split:
            continue
        content = read_verified_image(root, record)
        try:
            embeddings[record['image_id']] = engine.extract(content)
            status = 'valid'
        except InvalidImage as exc:
            status = str(exc)
            if status not in IMAGE_ERRORS:
                raise ValueError('Unknown extraction error; benchmark stopped.') from exc
            errors[record['image_id']] = status
        if status != record['status']:
            raise ValueError('Extraction status changed since validation; prepare a new versioned manifest.')
    return embeddings, errors


def score_pairs(records, split, embeddings, errors, compare, *, seed, max_impostors):
    rows = []
    for pair in generate_pairs(records, split, seed=seed, max_impostors=max_impostors):
        reference, webcam = pair['reference_id'], pair['webcam_id']
        if reference not in embeddings or webcam not in embeddings:
            rows.append({**pair, 'similarity': None,
                         'quality_issue': '|'.join(sorted({errors[k] for k in (reference, webcam) if k in errors}))})
        else:
            rows.append({**pair, 'similarity': compare(embeddings[reference], embeddings[webcam]), 'quality_issue': ''})
    return rows


def score_classes(rows):
    return ([r['similarity'] for r in rows if r['genuine'] and r['similarity'] is not None],
            [r['similarity'] for r in rows if not r['genuine'] and r['similarity'] is not None])


def coverage(rows) -> dict:
    planned_good = sum(r['genuine'] for r in rows)
    planned_bad = len(rows) - planned_good
    good, bad = score_classes(rows)
    return {'planned_genuine': planned_good, 'planned_impostor': planned_bad,
            'scored_genuine': len(good), 'scored_impostor': len(bad),
            'genuine_pairs_without_score': planned_good - len(good),
            'impostor_pairs_without_score': planned_bad - len(bad)}


def point_with_coverage(rows, threshold):
    point = operating_point(*score_classes(rows), threshold)
    counts = coverage(rows)
    point['end_to_end_genuine_nonaccept_rate'] = (point['false_rejects'] + counts['genuine_pairs_without_score']) / counts['planned_genuine']
    point['end_to_end_false_accept_rate'] = point['false_accepts'] / counts['planned_impostor']
    return point


def evaluate_split(rows, frozen_thresholds) -> tuple[dict, list[dict]]:
    good, bad = score_classes(rows)
    curve = roc_curve(good, bad)  # Deliberately fail if either class has no scores.
    result = {
        'coverage': coverage(rows), 'distribution': {'genuine': distribution(good), 'impostor': distribution(bad)},
        **curve_summary(curve), 'statistical_limitations': far_resolution(len(bad)),
        'descriptive_tar_at_far': tar_at_far(good, bad),
        'frozen_operating_points': {name: point_with_coverage(rows, value) for name, value in frozen_thresholds.items()},
    }
    return result, curve


def benchmark_cpu(records, root, engine, *, warmup, runs):
    if warmup < 1 or runs < 2:
        raise ValueError('CPU benchmark requires warmup>=1 and runs>=2.')
    # Timing inputs come exclusively from calibration. No held-out tuning.
    people = {}
    for record in records:
        if record['split'] == 'calibration' and record['status'] == 'valid':
            people.setdefault(record['identity_id'], {}).setdefault(record['role'], []).append(record)
    examples = []
    for person in sorted(people):
        roles = people[person]
        if 'reference' in roles and 'webcam' in roles:
            reference = read_verified_image(root, roles['reference'][0])
            for probe in roles['webcam']:
                examples.append((reference, read_verified_image(root, probe)))
                if len(examples) == runs:
                    break
            if len(examples) == runs:
                break
    if not examples:
        raise ValueError('CPU benchmark needs a valid calibration reference/webcam pair.')
    original = engine.service.recognizer
    timer = TimedRecognizer(original)
    engine.service.recognizer = timer
    extraction, feature, pair_times = [], [], []
    try:
        for i in range(warmup + runs):
            reference, probe = examples[i % len(examples)]
            started = time.perf_counter()
            engine.extract(probe)
            elapsed = (time.perf_counter() - started) * 1000
            if i >= warmup:
                extraction.append(elapsed)
                feature.append(timer.durations[-1])
        for i in range(warmup + runs):
            reference, probe = examples[i % len(examples)]
            started = time.perf_counter()
            first, second = engine.extract(reference), engine.extract(probe)
            engine.compare_embeddings(first, second)
            elapsed = (time.perf_counter() - started) * 1000
            if i >= warmup:
                pair_times.append(elapsed)
    finally:
        engine.service.recognizer = original
    return {'warmup_per_measurement': warmup, 'distinct_calibration_pairs_timed': len(examples),
            'recognition_feature_only': latency_summary(feature),
            'extract_embedding_encoded_image': latency_summary(extraction),
            'end_to_end_two_images_and_cosine': latency_summary(pair_times)}


def runtime_metadata() -> dict:
    versions = {}
    for name in ('numpy', 'opencv-python-headless', 'Pillow', 'matplotlib'):
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = None
    cpu = platform.processor()
    ram = None
    if sys.platform == 'win32':
        import ctypes
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'HARDWARE\DESCRIPTION\System\CentralProcessor\0') as key:
                cpu = winreg.QueryValueEx(key, 'ProcessorNameString')[0].strip()
            memory_kib = ctypes.c_ulonglong()
            if ctypes.windll.kernel32.GetPhysicallyInstalledSystemMemory(ctypes.byref(memory_kib)):
                ram = memory_kib.value * 1024
        except OSError:
            pass
    elif hasattr(os, 'sysconf'):
        try:
            ram = os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES')
        except (ValueError, OSError):
            pass
    commit = None
    if shutil.which('git'):
        try:
            result = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=Path(__file__).resolve().parents[2], capture_output=True, text=True, timeout=5)
            if result.returncode == 0:
                commit = result.stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            pass
    return {'python': platform.python_version(), 'platform': platform.platform(), 'cpu': cpu,
            'logical_cpus': os.cpu_count(), 'physical_ram_bytes': ram, 'git_commit': commit, 'versions': versions}


def failure_rows(rows_by_split, records, frozen_thresholds):
    images = {r['image_id']: r for r in records}
    for split, rows in rows_by_split.items():
        for name, threshold in frozen_thresholds.items():
            for row in rows:
                score = row['similarity']
                kind = ('quality_rejection' if score is None else
                        'false_reject' if row['genuine'] and score < threshold else
                        'false_accept' if not row['genuine'] and score >= threshold else None)
                if kind is None:
                    continue
                reference, probe = images[row['reference_id']], images[row['webcam_id']]
                yield {'split': split, 'operating_point': name, 'pair_id': row['pair_id'],
                       'failure': kind, 'similarity': score, 'quality_issue': row['quality_issue'],
                       **{f'webcam_{key}': value for key, value in probe['annotations'].items()},
                       **{f'reference_{key}': value for key, value in reference['annotations'].items()}}


def write_csv(path, rows, fieldnames):
    with path.open('w', encoding='utf-8', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def plot_reports(output, rows_by_split, curves):
    import matplotlib
    matplotlib.use('Agg')
    from matplotlib import pyplot as plt
    fig, ax = plt.subplots(figsize=(6, 5))
    for split, curve in curves.items():
        ax.plot([p['far'] for p in curve], [p['tar'] for p in curve], label=split)
    ax.plot([0, 1], [0, 1], '--', color='gray', linewidth=1)
    ax.set(xlabel='FAR (conditional on extraction)', ylabel='TAR', xlim=(0, 1), ylim=(0, 1), title='SFace reference to webcam ROC')
    ax.legend()
    fig.tight_layout()
    fig.savefig(output / 'roc.png', dpi=160)
    plt.close(fig)
    fig, axes = plt.subplots(1, 2, figsize=(10, 4), sharex=True)
    bins = [-1 + i * .05 for i in range(41)]
    for ax, (split, rows) in zip(axes, rows_by_split.items()):
        good, bad = score_classes(rows)
        ax.hist(good, bins=bins, density=True, alpha=.6, label='genuine')
        ax.hist(bad, bins=bins, density=True, alpha=.6, label='impostor')
        ax.set(xlabel='Cosine similarity', ylabel='Density', title=split)
        ax.legend()
    fig.tight_layout()
    fig.savefig(output / 'similarity_distribution.png', dpi=160)
    plt.close(fig)


def write_reports(output, summary, rows_by_split, curves, records, thresholds, extra_thresholds):
    output.mkdir(parents=True, exist_ok=False)
    write_json(output / 'metrics.json', summary)
    # Fixed grid is exploratory; selected thresholds always come from calibration.
    threshold_rows = []
    for split, rows in rows_by_split.items():
        selections = list(thresholds.items()) + [('exploratory_grid', t) for t in extra_thresholds]
        for name, threshold in selections:
            threshold_rows.append({'split': split, 'operating_point': name, **point_with_coverage(rows, threshold)})
    write_csv(output / 'threshold_report.csv', threshold_rows, list(threshold_rows[0]))
    for split, curve in curves.items():
        write_csv(output / f'roc_{split}.csv', curve, list(curve[0]))
    failure_fields = ['split', 'operating_point', 'pair_id', 'failure', 'similarity', 'quality_issue']
    from scripts.face_dataset import ANNOTATIONS
    failure_fields += [f'{role}_{key}' for role in ('webcam', 'reference') for key in ANNOTATIONS]
    write_csv(output / 'failure_analysis.csv', failure_rows(rows_by_split, records, thresholds), failure_fields)
    # Freeze full pairs (without scores/paths) so a future candidate uses EXACTLY this protocol.
    pair_fields = ['pair_id', 'split', 'reference_id', 'webcam_id', 'genuine']
    write_csv(output / 'pair_protocol.csv', ({key: r[key] for key in pair_fields}
              for rows in rows_by_split.values() for r in rows), pair_fields)
    plot_reports(output, rows_by_split, curves)
    lines = [
        '# SFace Phase 2 baseline', '',
        f"Protocol: `{PROTOCOL}`. Production changed: **NO**. Training performed: **NO**.", '',
        f"Manifest SHA-256: `{summary['manifest_sha256']}`.", '',
        'All selected thresholds are frozen on calibration identities. Test statistics are descriptive.', '',
        '| Split | Point | Threshold | FAR | FRR | TAR | Accuracy | End-to-end genuine nonaccept |',
        '|---|---|---:|---:|---:|---:|---:|---:|',
    ]
    for row in threshold_rows:
        lines.append(f"| {row['split']} | {row['operating_point']} | {row['threshold']:.9g} | {row['far']:.6g} | {row['frr']:.6g} | {row['tar']:.6g} | {row['accuracy']:.6g} | {row['end_to_end_genuine_nonaccept_rate']:.6g} |")
    lines += ['', '## Dataset and scores', '', '```json', json.dumps({
        'dataset': summary['dataset'],
        'results': {s: {key: value for key, value in result.items() if key != 'frozen_operating_points'}
                    for s, result in summary['results'].items()},
    }, indent=2), '```', '', '## CPU and model', '', '```json', json.dumps({
        'model': summary['model'], 'runtime': summary['runtime'], 'cpu_benchmark': summary['cpu_benchmark'],
        'load_ms_including_library_imports': summary['load_ms_including_library_imports'],
        'memory': summary['memory'],
    }, indent=2), '```', '', '## Training decision', '', summary['decision_gate']['reason'], '',
        f"Gate status: `{summary['decision_gate']['status']}`. No training is launched automatically.", '',
        'Failure analysis is categorical metadata only. Unknown lighting/pose is not inferred from similarity.', '',
        '## Limitations', '', *['- ' + text for text in summary['limitations']], '',
        'Candidate comparison and ONNX parity: not performed; require a justified experiment and the same frozen protocol.',
    ]
    (output / 'benchmark_report.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')


def run_benchmark(args):
    check_output(args.dataset, args.output)
    manifest = load_manifest(args.manifest, args.dataset)
    # Fail before inference if the optional report dependency is missing.
    import matplotlib
    matplotlib.use('Agg')
    random.seed(args.seed)
    import numpy as np
    np.random.seed(args.seed)
    before = memory_mb()
    started = time.perf_counter()
    engine = SFaceEngine(engine_arguments(args.threads))
    load_ms = (time.perf_counter() - started) * 1000
    loaded = memory_mb()
    model = model_metadata()
    if manifest.get('model') != model:
        raise ValueError('Validator model/preprocessing differs from baseline. Revalidate with this model version.')
    records = manifest['images']
    # Freeze thresholds BEFORE reading held-out images for inference.
    embeddings, errors = extract_split(records, args.dataset, engine, 'calibration')
    calibration_rows = score_pairs(records, 'calibration', embeddings, errors, engine.compare_embeddings,
                                   seed=args.seed, max_impostors=args.max_impostors)
    del embeddings
    thresholds = calibrate(*score_classes(calibration_rows), args.security_target_far)
    results, curves = {}, {}
    results['calibration'], curves['calibration'] = evaluate_split(calibration_rows, thresholds)
    timing = benchmark_cpu(records, args.dataset, engine, warmup=args.warmup, runs=args.runs)
    gate = decision_gate(results['calibration']['frozen_operating_points']['security'],
                         timing['extract_embedding_encoded_image']['p95_ms'],
                         max_far=args.acceptance_max_far, max_frr=args.acceptance_max_frr,
                         max_latency_ms=args.acceptance_max_latency_ms)
    embeddings, errors = extract_split(records, args.dataset, engine, 'test')
    test_rows = score_pairs(records, 'test', embeddings, errors, engine.compare_embeddings,
                           seed=args.seed, max_impostors=args.max_impostors)
    del embeddings
    results['test'], curves['test'] = evaluate_split(test_rows, thresholds)
    for split in ('calibration', 'test'):
        identities = len({r['identity_id'] for r in records if r['split'] == split})
        probes = sum(r['role'] == 'webcam' and r['split'] == split for r in records)
        possible = probes * (identities - 1)
        results[split]['pair_sampling'] = {
            'available_impostor_pairs': possible,
            'selected_impostor_pairs': results[split]['coverage']['planned_impostor'],
            'sampling_fraction': results[split]['coverage']['planned_impostor'] / possible,
            'method': 'all-pairs' if args.max_impostors is None or args.max_impostors >= possible else 'uniform_without_replacement',
        }
    rows_by_split = {'calibration': calibration_rows, 'test': test_rows}
    summary = {
        'created_at_utc': datetime.now(timezone.utc).isoformat(), 'protocol': PROTOCOL,
        'dataset': dataset_summary(records), 'model': model, 'runtime': runtime_metadata(),
        'manifest_sha256': file_sha256(args.manifest), 'seed': args.seed,
        'config': {'threads': args.threads, 'warmup': args.warmup, 'runs': args.runs,
                   'max_impostors_per_split': args.max_impostors, 'security_target_far': args.security_target_far,
                   'exploratory_thresholds': args.thresholds,
                   'acceptance_max_far': args.acceptance_max_far, 'acceptance_max_frr': args.acceptance_max_frr,
                   'acceptance_max_latency_ms': args.acceptance_max_latency_ms},
        'script_hashes': {p.name: file_sha256(p) for p in (Path(__file__),
            Path(__file__).with_name('face_dataset.py'), Path(__file__).with_name('face_metrics.py'),
            Path(__file__).with_name('prepare_face_dataset.py'), Path(__file__).with_name('benchmark_face_verification.py'))},
        'threshold_source': 'calibration only', 'frozen_thresholds': thresholds,
        'results': results, 'cpu_benchmark': timing, 'load_ms_including_library_imports': load_ms,
        'memory': {'before_model': before, 'after_model': loaded, 'after_benchmark': memory_mb()},
        'decision_gate': gate, 'training_performed': False, 'production_changed': False,
        'limitations': LIMITATIONS,
    }
    write_reports(args.output, summary, rows_by_split, curves, records, thresholds, args.thresholds)
    print(json.dumps({'status': 'BASELINE_REPORTED', 'decision_gate': gate,
                      'training_performed': False, 'production_changed': False}, ensure_ascii=False, indent=2))
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--max-impostors', type=int, help='Per split; omit for all-pairs. Genuine pairs are never downsampled.')
    parser.add_argument('--security-target-far', type=float, required=True, help='Exploratory calibration target supplied by operator; not a production policy.')
    parser.add_argument('--thresholds', type=float, nargs='+', default=[.36, .40, .45, .50, .55, .60])
    parser.add_argument('--threads', type=int, default=1)
    parser.add_argument('--warmup', type=int, default=10)
    parser.add_argument('--runs', type=int, default=100)
    parser.add_argument('--acceptance-max-far', type=float)
    parser.add_argument('--acceptance-max-frr', type=float)
    parser.add_argument('--acceptance-max-latency-ms', type=float, help='p95 of extract_embedding, CPU milliseconds.')
    args = parser.parse_args(argv)
    if not 0 <= args.seed < 2**32 or args.threads < 1 or args.warmup < 1 or args.runs < 2:
        parser.error('Need 0<=seed<2^32, threads>=1, warmup>=1 and runs>=2.')
    if not math.isfinite(args.security_target_far) or not 0 <= args.security_target_far < 1:
        parser.error('Security target FAR must be finite and in [0,1).')
    if args.max_impostors is not None and args.max_impostors < 1:
        parser.error('max-impostors must be positive.')
    if any(not math.isfinite(t) or not -1 <= t <= 1 for t in args.thresholds):
        parser.error('Exploratory thresholds must be finite and in [-1,1].')
    criteria = (args.acceptance_max_far, args.acceptance_max_frr, args.acceptance_max_latency_ms)
    if any(c is not None for c in criteria):
        if not all(c is not None and math.isfinite(c) for c in criteria):
            parser.error('Supply all three finite acceptance requirements or none.')
        if not 0 <= criteria[0] < 1 or not 0 <= criteria[1] < 1 or criteria[2] <= 0:
            parser.error('Invalid FAR/FRR/latency acceptance requirements.')
    run_benchmark(args)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, ImportError) as exc:
        raise SystemExit(f'Phase 2 benchmark stopped: {exc}') from None
    except OSError:
        raise SystemExit('Phase 2 benchmark stopped: local file access failed; check paths and permissions.') from None
