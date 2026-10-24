"""Opt-in local OCR diagnostics. Never called by HTTP requests or server logs.

Run from backend: python scripts/debug_student_card_ocr.py path/to/card.jpg
Output contains card text; keep any saved report in private storage.
"""
import argparse
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.student_card_matching import MIN_FIELD_CONFIDENCE, PARSER_VERSION, compare_fields, field_regions, normalize_name, parse_fields
from app.services.student_card_ocr import LocalOCR, MODEL_VERSION
from app.services.student_card_class import class_preview_metadata, MIN_CLASS_CONFIDENCE


def main():
    # Windows' default code page cannot print all Vietnamese OCR characters.
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image', type=Path)
    parser.add_argument('--output', type=Path, help='Optional private JSON report path')
    parser.add_argument('--full-name', help='Optional expected profile name, only for final validation diagnostics')
    parser.add_argument('--student-code', help='Optional expected profile code, never used to choose OCR candidates')
    args = parser.parse_args()
    content = args.image.read_bytes()
    adapter = LocalOCR()
    try:
        adapter.start()
        lines = adapter.recognize(content)
    finally:
        adapter.close()
    diagnostics = []
    fields, confidence = parse_fields(lines, diagnostics=diagnostics)
    report = {'image_sha256': hashlib.sha256(content).hexdigest(), 'ocr_model_version': MODEL_VERSION,
              'parser_version': PARSER_VERSION, 'raw_text': '\n'.join(line.text for line in lines),
              'lines': [asdict(line) for line in lines], 'parser_candidates': diagnostics,
              'raw_global_ocr': [asdict(line) for line in lines.raw_global_ocr],
              'field_ocr': [asdict(read) for read in lines.field_ocr],
              'pipeline_stages': getattr(lines, 'pipeline_diagnostics', []),
              'field_regions': field_regions(lines),
              'extracted': fields, 'confidence': confidence,
              'ocr_display_name': fields['full_name'],
              'normalized_name': normalize_name(fields['full_name']),
              'required_field_min_confidence': MIN_FIELD_CONFIDENCE,
              'required_fields_readable': {field: bool(fields[field]) and (confidence[field] or 0) >= MIN_FIELD_CONFIDENCE
                                           for field in ('full_name', 'student_code')}}
    report['class_preview_metadata'] = class_preview_metadata(fields, confidence)
    report['class_display_min_confidence'] = MIN_CLASS_CONFIDENCE
    report['pipeline_stages'].extend([
        {'stage': 'parser', 'status': 'ok', 'extracted_fields': sum(bool(value) for value in fields.values())},
        {'stage': 'confidence', 'status': 'ok', 'required_minimum': MIN_FIELD_CONFIDENCE,
         'readable_fields': report['required_fields_readable']},
    ])
    if args.full_name and args.student_code:
        report['required_field_validation'] = compare_fields(fields, confidence, args.full_name, args.student_code)
        validation = report['required_field_validation']
        report['pipeline_stages'].append({'stage': 'required_field_validation',
            'status': 'passed' if validation['can_confirm'] else 'blocked',
            'blocking_errors': validation['blocking_errors']})
    output = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output + '\n', encoding='utf-8')
    print(output)


if __name__ == '__main__':
    main()
