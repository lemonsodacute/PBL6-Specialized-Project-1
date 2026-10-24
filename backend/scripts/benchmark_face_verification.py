"""Offline 1:1 card/webcam benchmark. No downloads, DB access or application writes.

See docs/FACE_VERIFICATION_ANALYSIS.md for dataset, licenses and interpretation.
Only --output is written. All models/datasets must already exist locally.
"""
from __future__ import annotations

import argparse
from collections import Counter
import csv
import ctypes
from datetime import datetime, timezone
import hashlib
from io import BytesIO
import json
import math
import os
from pathlib import Path
import platform
import statistics
import sys
import time
import warnings

BACKEND = Path(__file__).resolve().parents[1]
MODEL_DIR = BACKEND / "models" / "face"


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def memory_mb():
    """Process working set/RSS, not Python-only allocations; peak is OS high water."""
    if sys.platform == "win32":
        from ctypes import wintypes

        class Counters(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
                (name, ctypes.c_size_t) for name in (
                    "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                    "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage",
                    "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage")]

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        kernel.GetCurrentProcess.restype = wintypes.HANDLE
        psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        if not psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
            raise ctypes.WinError(ctypes.get_last_error())
        return {"rss_mb": counters.WorkingSetSize / 2**20, "peak_rss_mb": counters.PeakWorkingSetSize / 2**20}
    import resource
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    peak /= 2**20 if sys.platform == "darwin" else 1024
    rss = None
    if sys.platform.startswith("linux"):
        rss = int(Path("/proc/self/statm").read_text().split()[1]) * os.sysconf("SC_PAGE_SIZE") / 2**20
    return {"rss_mb": rss, "peak_rss_mb": peak}


class InvalidImage(ValueError):
    pass


class SFaceEngine:
    """Benchmark adapter: reuse the production service, including preprocessing."""
    def __init__(self, args):
        if str(BACKEND) not in sys.path:
            sys.path.insert(0, str(BACKEND))
        from fastapi import HTTPException
        from app.services.face_recognition import EMBEDDING_DIM, FaceEngine

        self._http_exception = HTTPException
        try:
            self.service = FaceEngine(detector_path=args.detector, recognizer_path=args.recognizer)
        except HTTPException as exc:
            raise ValueError(exc.detail['code']) from exc
        self.cv, self.np = self.service.cv, self.service.np
        self.cv.setNumThreads(args.threads)
        self.detector = self.service.detector
        self.dimensions = EMBEDDING_DIM

    def extract(self, content):
        try:
            return self.service.extract_embedding(content)
        except self._http_exception as exc:
            if exc.status_code >= 500:
                # A broken model must stop a run, not become a skipped image.
                raise ValueError(exc.detail['code']) from exc
            raise InvalidImage(exc.detail['code']) from exc

    def embed(self, aligned):
        # Synthetic recognition-only smoke; no second SFace normalization path.
        with self.service.lock:
            return self.service._embedding_from_aligned(aligned)

    def compare_embeddings(self, first, second):
        return self.service.compare_embeddings(first, second)


class ArcFaceEngine:
    """Existing experimental YuNet/ArcFace ablation, not the full buffalo_l pack."""
    def __init__(self, args):
        import cv2
        import numpy as np
        from PIL import Image, ImageOps
        self.cv, self.np, self.Image, self.ImageOps = cv2, np, Image, ImageOps
        cv2.setNumThreads(args.threads)
        self.detector = cv2.FaceDetectorYN.create(str(args.detector), "", (320, 320), 0.85, 0.3, 5000)
        import onnxruntime as ort
        options = ort.SessionOptions()
        options.intra_op_num_threads = args.threads
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(str(args.recognizer), sess_options=options, providers=["CPUExecutionProvider"])
        inputs, outputs = self.session.get_inputs(), self.session.get_outputs()
        if len(inputs) != 1 or inputs[0].shape[1:] != [3, 112, 112] or inputs[0].type != "tensor(float)":
            raise ValueError("ArcFace adapter requires float32 NCHW [1,3,112,112].")
        if inputs[0].shape[0] not in (1, None) and not isinstance(inputs[0].shape[0], str):
            raise ValueError("ArcFace adapter requires batch=1 or dynamic batch.")
        if len(outputs) != 1 or outputs[0].shape[-1] != 512:
            raise ValueError("ArcFace adapter requires one 512-dimensional output.")
        self.input_name = inputs[0].name
        self.dimensions = 512

    def align(self, pixels, face):
        # Deterministic least-squares similarity transform (no RANSAC).
        # Same 112x112 five-point template used by OpenCV SFace/InsightFace.
        np = self.np
        source = face[4:14].reshape(5, 2).astype(np.float64)
        target = np.array([[38.2946, 51.6963], [73.5318, 51.5014],
                           [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]])
        matrix = np.zeros((10, 4))
        matrix[0::2] = np.column_stack([source[:, 0], -source[:, 1], np.ones(5), np.zeros(5)])
        matrix[1::2] = np.column_stack([source[:, 1], source[:, 0], np.zeros(5), np.ones(5)])
        a, b, tx, ty = np.linalg.lstsq(matrix, target.reshape(-1), rcond=None)[0]
        transform = np.array([[a, -b, tx], [b, a, ty]])
        return self.cv.warpAffine(pixels, transform, (112, 112), flags=self.cv.INTER_LINEAR)

    def embed(self, aligned):
        # Only for explicitly acknowledged w600k-style external preprocessing.
        # Never reuse this normalization for SFace or arbitrary ONNX models.
        blob = self.cv.dnn.blobFromImage(aligned, 1 / 127.5, (112, 112), (127.5,) * 3, swapRB=True)
        vector = self.session.run(None, {self.input_name: blob})[0].reshape(-1)
        norm = self.np.linalg.norm(vector)
        if vector.size != self.dimensions or not self.np.isfinite(vector).all() or not norm > 0:
            raise InvalidImage("INVALID_EMBEDDING")
        return vector / norm

    def compare_embeddings(self, first, second):
        return float(self.np.clip(self.np.dot(first, second), -1, 1))

    def extract(self, content):
        if not content:
            raise InvalidImage("EMPTY_IMAGE")
        if len(content) > 8 * 1024 * 1024:
            raise InvalidImage("IMAGE_TOO_LARGE")
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", self.Image.DecompressionBombWarning)
                with self.Image.open(BytesIO(content)) as source:
                    if source.format not in {"JPEG", "PNG", "WEBP"} or min(source.size) < 160 or source.width * source.height > 16_000_000:
                        raise InvalidImage("INVALID_IMAGE")
                    source.load()
                    frame = self.ImageOps.exif_transpose(source).convert("RGB")
                    frame.thumbnail((1280, 1280))
        except (OSError, ValueError, self.Image.DecompressionBombError, self.Image.DecompressionBombWarning) as exc:
            raise InvalidImage("INVALID_IMAGE") from exc
        pixels = self.cv.cvtColor(self.np.array(frame), self.cv.COLOR_RGB2BGR)
        self.detector.setInputSize((pixels.shape[1], pixels.shape[0]))
        _, faces = self.detector.detect(pixels)
        if faces is None or len(faces) == 0:
            raise InvalidImage("FACE_NOT_FOUND")
        if len(faces) != 1:
            raise InvalidImage("MULTIPLE_FACES")
        if min(faces[0][2:4]) < 80:
            raise InvalidImage("FACE_TOO_SMALL")
        aligned = self.align(pixels, faces[0])
        gray = self.cv.cvtColor(aligned, self.cv.COLOR_BGR2GRAY)
        if gray.mean() < 35:
            raise InvalidImage("FACE_TOO_DARK")
        if self.cv.Laplacian(gray, self.cv.CV_64F).var() < 15:
            raise InvalidImage("FACE_TOO_BLURRY")
        return self.embed(aligned)


def roc_curve(genuine, impostor):
    if not genuine or not impostor:
        raise ValueError("Need both genuine and impostor scores in each split.")
    groups = {}
    for label, scores in ((1, genuine), (0, impostor)):
        for score in scores:
            if not math.isfinite(score):
                raise ValueError("Non-finite score")
            groups.setdefault(score, [0, 0])[label] += 1
    rows = [{"threshold": math.nextafter(max(groups), math.inf), "far": 0.0, "frr": 1.0, "tpr": 0.0}]
    accepted_genuine = accepted_impostor = 0
    for score in sorted(groups, reverse=True):
        bad, good = groups[score]
        accepted_genuine += good
        accepted_impostor += bad
        tpr = accepted_genuine / len(genuine)
        rows.append({"threshold": score, "far": accepted_impostor / len(impostor), "frr": 1 - tpr, "tpr": tpr})
    return rows


def choose_threshold(rows, target_far):
    feasible = [row for row in rows if row["far"] <= target_far]
    # Highest genuine acceptance, then lower FAR, then stricter tie threshold.
    return max(feasible, key=lambda r: (r["tpr"], -r["far"], r["threshold"]))["threshold"]


def metrics(genuine, impostor, threshold):
    accepted_bad = sum(score >= threshold for score in impostor)
    rejected_good = sum(score < threshold for score in genuine)
    far, frr = accepted_bad / len(impostor), rejected_good / len(genuine)
    curve = roc_curve(genuine, impostor)
    nearest = min(curve, key=lambda row: abs(row["far"] - row["frr"]))
    return {"genuine_pairs": len(genuine), "impostor_pairs": len(impostor),
            "false_accepts": accepted_bad, "false_rejects": rejected_good,
            "far": far, "frr": frr, "tar": 1 - frr,
            "accuracy": 1 - (accepted_bad + rejected_good) / (len(genuine) + len(impostor)),
            "balanced_accuracy": 1 - (far + frr) / 2,
            "eer_nearest_empirical_point": (nearest["far"] + nearest["frr"]) / 2,
            "eer_far_frr_gap": abs(nearest["far"] - nearest["frr"])}


def load_manifest(path):
    """One identity per row; paths relative to manifest; explicit identity split."""
    records = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(records, list) or not records:
        raise ValueError("Manifest must be a nonempty JSON list.")
    subjects, images, seen_hashes = set(), set(), set()
    for record in records:
        subject = record["subject_id"]
        if not isinstance(subject, str) or not subject or subject in subjects:
            raise ValueError("Each subject_id must occur once, in only one split.")
        subjects.add(subject)
        if record["split"] not in {"calibration", "test"}:
            raise ValueError("split must be calibration or test.")
        if not isinstance(record["webcam_images"], list) or not record["webcam_images"]:
            raise ValueError("Each subject needs at least one webcam image.")
        for key in ("card_image", "webcam_images"):
            values = [record[key]] if key == "card_image" else record[key]
            resolved = []
            for value in values:
                image = (path.parent / value).resolve()
                if not image.is_file():
                    raise ValueError(f"Missing dataset image for subject {subject}.")
                digest = sha256(image)
                if image in images or digest in seen_hashes:
                    raise ValueError("Duplicate image/path across enrollment, probes or splits.")
                images.add(image)
                seen_hashes.add(digest)
                resolved.append(image)
            record[key] = resolved[0] if key == "card_image" else resolved
    for split in ("calibration", "test"):
        if sum(r["split"] == split for r in records) < 2:
            raise ValueError("Each split needs at least two distinct identities for impostor pairs.")
    return records


def write_csv(path, rows):
    if rows:
        with path.open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)


def percentiles(values):
    ordered = sorted(values)
    return {"count": len(values), "p50_ms": statistics.median(values),
            "p95_ms": ordered[max(0, math.ceil(len(values) * .95) - 1)]} if values else None


def self_test():
    good, bad = [0.8, 0.9], [0.1, 0.2]
    threshold = choose_threshold(roc_curve(good, bad), 0)
    assert metrics(good, bad, threshold)["balanced_accuracy"] == 1
    assert metrics([0.5], [0.5], 0.5)["far"] == 1  # equality means accepted
    assert metrics([0.5], [0.5], 0.5)["frr"] == 0
    assert metrics([0.1], [0.9], 0.5)["balanced_accuracy"] == 0
    assert choose_threshold(roc_curve([0.5], [0.5]), 0) > 0.5
    assert len(roc_curve([0.5, 0.5], [0.5])) == 2  # tied scores form one step
    try:
        roc_curve([], [0.1])
        raise AssertionError("Missing class accepted")
    except ValueError:
        pass
    print("Metric checks passed: perfect/reversed scores, boundary ties, reject-all, missing class.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--engine", choices=["sface", "arcface"], default="sface")
    parser.add_argument("--detector", type=Path, default=MODEL_DIR / "face_detection_yunet_2023mar.onnx")
    parser.add_argument("--recognizer", type=Path)
    parser.add_argument("--arcface-preprocessing", choices=["rgb-127.5"])
    parser.add_argument("--target-far", type=float, default=0.01, help="Exploratory calibration target; NOT an exam policy (default .01).")
    parser.add_argument("--threads", type=int, default=1)
    parser.add_argument("--warmup", type=int, default=3)
    parser.add_argument("--smoke", action="store_true", help="Synthetic runtime check; no verification accuracy claimed.")
    parser.add_argument("--self-test", action="store_true", help="Check metrics without models or datasets.")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if not 0 <= args.target_far < 1 or args.threads < 1 or args.warmup < 0:
        parser.error("Invalid target FAR, thread count or warmup count.")
    if args.engine == "arcface" and (args.recognizer is None or args.arcface_preprocessing is None):
        parser.error("Supply local licensed --recognizer and acknowledge its contract with --arcface-preprocessing rgb-127.5.")
    if args.recognizer is None:
        args.recognizer = MODEL_DIR / "face_recognition_sface_2021dec.onnx"
    for path in (args.detector, args.recognizer):
        if not path.is_file():
            parser.error(f"Local model missing: {path.name}. Nothing will be downloaded.")
    records = None
    if not args.smoke:
        if args.manifest is None or args.output is None:
            parser.error("Dataset run requires --manifest and a NEW --output directory.")
        if args.output.exists():
            parser.error("Output already exists; choose a new directory to preserve earlier results.")
        records = load_manifest(args.manifest.resolve())
    before = memory_mb()
    started = time.perf_counter()
    engine = SFaceEngine(args) if args.engine == 'sface' else ArcFaceEngine(args)
    load_ms = (time.perf_counter() - started) * 1000
    loaded = memory_mb()
    import importlib.metadata as metadata
    versions = {}
    for name in ("opencv-python-headless", "numpy", "Pillow", "onnxruntime"):
        try:
            versions[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            pass
    summary = {"created_at_utc": datetime.now(timezone.utc).isoformat(),
               "engine": args.engine, "protocol": "one-card-to-one-webcam-cosine",
               "preprocessing": "yunet-0.85-max1280-minface80-dark35-blur15-5pt112-v1",
               "recognizer_input": "RGB-float32-0..255" if args.engine == "sface" else "RGB-float32-(x-127.5)/127.5",
               "embedding_dimensions": engine.dimensions, "versions": versions,
               "platform": platform.platform(), "processor": platform.processor(),
               "logical_cpus": os.cpu_count(), "threads": args.threads,
               "load_ms_including_library_imports": load_ms, "memory_before": before,
               "memory_after_load": loaded,
               "models": [{"file": p.name, "bytes": p.stat().st_size, "sha256": sha256(p)} for p in (args.detector, args.recognizer)]}
    if args.smoke:
        rng = engine.np.random.default_rng(20261002)
        crop = rng.integers(0, 256, (112, 112, 3), dtype=engine.np.uint8)
        durations = []
        for index in range(args.warmup + 20):
            started = time.perf_counter()
            vector = engine.embed(crop)
            if index >= args.warmup:
                durations.append((time.perf_counter() - started) * 1000)
        assert abs(float(engine.np.linalg.norm(vector)) - 1) < 1e-5
        engine.detector.setInputSize((640, 480))
        _, faces = engine.detector.detect(engine.np.zeros((480, 640, 3), dtype=engine.np.uint8))
        assert faces is None or len(faces) == 0
        summary.update({"synthetic_only": True, "recognizer_only_latency": percentiles(durations), "memory_end": memory_mb()})
        print(json.dumps(summary, indent=2))
        return
    # Warm detection/alignment/recognition using an actual image when available.
    warm_sample = None
    for record in records:
        candidate = record["card_image"].read_bytes()
        try:
            engine.extract(candidate)
            warm_sample = candidate
            break
        except InvalidImage:
            pass
    warmup_found_valid_card = warm_sample is not None
    if warmup_found_valid_card:
        for _ in range(args.warmup):
            engine.extract(warm_sample)
    del warm_sample
    embeddings, errors, timings, cpu_times, image_rows = {}, [], [], [], []
    for record in records:
        for kind, image_paths in (("card", [record["card_image"]]), ("webcam", record["webcam_images"])):
            for index, path in enumerate(image_paths):
                wall, cpu = time.perf_counter(), time.process_time()
                error = None
                try:
                    embeddings[path] = engine.extract(path.read_bytes())
                except InvalidImage as exc:
                    error = str(exc)
                    errors.append({"split": record["split"], "subject_id": record["subject_id"], "kind": kind, "index": index, "error": error})
                elapsed, cpu_ms = (time.perf_counter() - wall) * 1000, (time.process_time() - cpu) * 1000
                if error is None:
                    timings.append(elapsed)
                    cpu_times.append(cpu_ms)
                image_rows.append({"split": record["split"], "subject_id": record["subject_id"], "kind": kind, "index": index, "latency_ms": elapsed, "cpu_ms": cpu_ms, "error": error or ""})
    pair_rows, splits, curves = [], {}, {}
    for split in ("calibration", "test"):
        people = [record for record in records if record["split"] == split]
        genuine, impostor = [], []
        for probe_person in people:
            for index, probe in enumerate(probe_person["webcam_images"]):
                for reference_person in people:
                    card = reference_person["card_image"]
                    if card not in embeddings or probe not in embeddings:
                        continue
                    score = engine.compare_embeddings(embeddings[card], embeddings[probe])
                    same = probe_person["subject_id"] == reference_person["subject_id"]
                    (genuine if same else impostor).append(score)
                    pair_rows.append({"split": split, "reference_subject": reference_person["subject_id"], "probe_subject": probe_person["subject_id"], "probe_index": index, "genuine": same, "similarity": score})
        curves[split] = roc_curve(genuine, impostor)
        splits[split] = {"genuine": genuine, "impostor": impostor,
                         "subjects": len(people), "planned_genuine": sum(len(r["webcam_images"]) for r in people)}
    threshold = choose_threshold(curves["calibration"], args.target_far)
    results = {}
    for split, data in splits.items():
        result = metrics(data["genuine"], data["impostor"], threshold)
        planned = data["planned_genuine"]
        missing = planned - len(data["genuine"])
        result.update({"subjects": data["subjects"], "planned_genuine": planned,
                       "planned_impostor": planned * (data["subjects"] - 1),
                       "genuine_pairs_without_score": missing,
                       "end_to_end_genuine_nonaccept_rate": (missing + result["false_rejects"]) / planned})
        results[split] = result
    summary.update({"manifest_sha256": sha256(args.manifest), "target_far_calibration": args.target_far,
                    "threshold_calibrated_only_on_calibration_subjects": threshold,
                    "results": results, "successful_extraction_latency_including_disk_decode": percentiles(timings),
                    "successful_extraction_cpu_time": percentiles(cpu_times),
                    "warmup_found_valid_card": warmup_found_valid_card,
                    "memory_end": memory_mb(), "image_error_counts": dict(Counter(e["error"] for e in errors)),
                    "limitations": ["Small correlated pair set; empirical FAR is not a production guarantee.",
                                    "FAR/FRR/ROC conditional on successful extraction; failure coverage reported separately.",
                                    "No HTTP, database, concurrent-load or three-webcam median policy measurement.",
                                    "ArcFace mode shares YuNet, so it does not measure the complete buffalo_l pack."]})
    args.output.mkdir(parents=True, exist_ok=False)
    (args.output / "summary.json").write_text(json.dumps(summary, indent=2, allow_nan=False), encoding="utf-8")
    for name, rows in (("pairs", pair_rows), ("images", image_rows), ("errors", errors),
                       ("roc_calibration", curves["calibration"]), ("roc_test", curves["test"])):
        write_csv(args.output / f"{name}.csv", rows)
    print(json.dumps({"output": str(args.output), "threshold": threshold, "results": results}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, ImportError) as exc:
        raise SystemExit(f"Benchmark stopped: {exc}") from exc
