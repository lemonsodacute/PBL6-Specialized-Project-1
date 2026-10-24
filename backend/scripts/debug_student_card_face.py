"""Local geometry/quality diagnostics; prints no images or embedding values.

Run from backend: python scripts/debug_student_card_face.py path/to/card.jpg
"""
import argparse
import json
import logging
from pathlib import Path
import sys


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image', type=Path)
    args = parser.parse_args()
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

    from fastapi import HTTPException
    from app.core.config import get_settings
    from app.services.face_recognition import FaceEngine

    logging.basicConfig(level=logging.INFO, format='%(message)s', stream=sys.stdout)
    get_settings().CARD_FACE_DEBUG = True  # Production environment gate still applies.
    engine = FaceEngine()
    content = args.image.read_bytes()
    frame = engine._decode_image(content)
    original_width, original_height = frame.info['face_original_size']
    pixels = engine.cv.cvtColor(engine.np.array(frame), engine.cv.COLOR_RGB2BGR)
    # Raw 1x measurement is diagnostic only; CARD operations below use the
    # actual production code path, including 2x detection and all quality gates.
    with engine.lock:
        engine.detector.setInputSize(frame.size)
        _, faces = engine.detector.detect(pixels)
        measurements = []
        for face in ([] if faces is None else faces):
            original_bbox = face[:4] / engine.np.array([
                frame.width / original_width, frame.height / original_height,
                frame.width / original_width, frame.height / original_height,
            ])
            aligned = engine.recognizer.alignCrop(pixels, face)
            gray = engine.cv.cvtColor(aligned, engine.cv.COLOR_BGR2GRAY)
            measurements.append({
                'bbox': face[:4].tolist(), 'original_equivalent_bbox': original_bbox.tolist(),
                'face_ratio': [float(original_bbox[2] / original_width), float(original_bbox[3] / original_height)],
                'score': float(face[14]), 'brightness': float(gray.mean()),
                'blur': float(engine.cv.Laplacian(gray, engine.cv.CV_64F).var()),
            })
    print('CARD_FACE_NATIVE: ' + json.dumps({
        'image_size': [original_width, original_height], 'decoded_size': list(frame.size),
        'faces': measurements,
    }, separators=(',', ':')))
    passed = True
    for operation in ('preview', 'confirm'):
        try:
            if operation == 'preview':
                card, face = engine.prepare_card(content)
                result = {'passed': True, 'card_jpeg_bytes': len(card), 'face_jpeg_bytes': len(face)}
            else:
                embedding = engine.extract_embedding(content, mode='card')
                result = {'passed': True, 'embedding_dimension': len(embedding),
                          'embedding_finite': bool(engine.np.isfinite(embedding).all()),
                          'embedding_norm': float(engine.np.linalg.norm(embedding))}
        except HTTPException as exc:
            passed = False
            result = {'passed': False, 'reject_reason': exc.detail['code']}
        print(f'CARD_FACE_{operation.upper()}: ' + json.dumps(result, separators=(',', ':')))
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
