"""Validate a local reference/webcam dataset with the unchanged production engine."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

if __name__ == '__main__' and __package__ is None:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.benchmark_face_verification import InvalidImage, SFaceEngine, MODEL_DIR
from scripts.face_dataset import (
    IMAGE_ERRORS, PROTOCOL, SCHEMA_VERSION, check_output, dataset_summary,
    discover_dataset, file_sha256, read_verified_image, split_identities, write_json,
)


def model_metadata() -> dict:
    from app.core.face_config import (
        EMBEDDING_DIM, FACE_PREPROCESSING_VERSION, SFACE_MODEL_NAME, SFACE_MODEL_VERSION,
    )
    return {
        'MODEL_NAME': SFACE_MODEL_NAME, 'MODEL_VERSION': SFACE_MODEL_VERSION,
        'PREPROCESSING_VERSION': FACE_PREPROCESSING_VERSION, 'EMBEDDING_DIMENSION': EMBEDDING_DIM,
        'models': {name: {'bytes': (MODEL_DIR / name).stat().st_size, 'sha256': file_sha256(MODEL_DIR / name)}
                   for name in ('face_detection_yunet_2023mar.onnx', 'face_recognition_sface_2021dec.onnx')},
        'production_service_sha256': file_sha256(Path(__file__).resolve().parents[1] / 'app/services/face_recognition.py'),
    }


def engine_arguments(threads: int):
    return argparse.Namespace(
        detector=MODEL_DIR / 'face_detection_yunet_2023mar.onnx',
        recognizer=MODEL_DIR / 'face_recognition_sface_2021dec.onnx', threads=threads,
    )


def validate_images(records: list[dict], root: Path, engine) -> list[dict]:
    """Decode/EXIF/bbox/size/alignment/quality are all owned by FaceEngine.

    Calling extraction also checks the model output. The embedding is discarded;
    neither original images nor aligned crops nor vectors are persisted.
    """
    result = []
    for record in records:
        content = read_verified_image(root, record)
        try:
            engine.extract(content)
            status = 'valid'
        except InvalidImage as exc:
            status = str(exc)
            if status not in IMAGE_ERRORS:
                raise ValueError('Unknown extraction error; validation stopped.') from exc
        result.append({**record, 'status': status})
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True, help='New local-only directory outside dataset.')
    parser.add_argument('--ratios', type=float, nargs='+', default=[.6, .2, .2], help='train/calibration/test or calibration/test; sum=1.')
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--threads', type=int, default=1)
    parser.add_argument('--annotations', type=Path, help='Optional categorical annotations JSON; never inferred from filenames.')
    args = parser.parse_args(argv)
    if args.threads < 1 or not 0 <= args.seed < 2**32:
        parser.error('Need threads>=1 and 0<=seed<2^32.')
    check_output(args.dataset, args.output)
    annotations = json.loads(args.annotations.read_text(encoding='utf-8-sig')) if args.annotations else None
    records = split_identities(discover_dataset(args.dataset, annotations), args.ratios, args.seed)
    engine = SFaceEngine(engine_arguments(args.threads))
    records = validate_images(records, args.dataset, engine)
    summary = dataset_summary(records)
    manifest = {
        'schema_version': SCHEMA_VERSION, 'protocol': PROTOCOL,
        'created_at_utc': datetime.now(timezone.utc).isoformat(),
        'seed': args.seed, 'split_ratios': args.ratios, 'model': model_metadata(),
        'images': records,
    }
    args.output.mkdir(parents=True, exist_ok=False)
    write_json(args.output / 'manifest.json', manifest)
    write_json(args.output / 'validation_report.json', summary)
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, ImportError) as exc:
        raise SystemExit(f'Dataset validation stopped: {exc}') from None
    except OSError:
        raise SystemExit('Dataset validation stopped: local file access failed; check paths and permissions.') from None
