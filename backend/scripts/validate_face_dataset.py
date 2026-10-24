"""Read-only collection summary, including incomplete identities; no split needed."""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import sys

if __name__ == '__main__' and __package__ is None:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.collect_face_dataset import (
    CAPTURE_LABELS, DEFAULT_DATASET, CollectionError, DatasetStore, ImageRejected,
    QualityValidator, validate_person_id,
)
from scripts.face_dataset import IMAGE_ERRORS, file_sha256


def summarize_dataset(root, validator_factory=QualityValidator):
    """Validate ALL image files; do not filter hard images or modify metadata."""
    store = DatasetStore(root)
    summary = {
        'identities': 0, 'reference_images': 0, 'webcam_images': 0,
        'total_images': 0, 'valid': 0, 'rejected': 0,
        'rejection_counts': {code: 0 for code in sorted(IMAGE_ERRORS)},
        'complete_identities': 0, 'incomplete_identities': 0,
        'average_webcam_images_per_identity': None,
        'capture_label_counts': {label: 0 for label in CAPTURE_LABELS},
        'metadata_rows': 0, 'images_without_metadata': 0, 'stale_metadata_rows': 0,
        'duplicate_image_contents': 0, 'structure_issues': [],
        'status': 'DATASET_INSUFFICIENT', 'production_changed': False,
    }
    if not store.root.is_dir():
        summary['structure_issues'].append('DATASET_MISSING')
        return summary
    if store.checked_path('.collection.lock').exists():
        raise CollectionError('Collection is in progress/locked; close the collector before validation.')
    metadata = store.metadata()
    indexed = {row['filename']: row for row in metadata['images']}
    summary['metadata_rows'] = len(indexed)
    seen_files, seen_hashes = set(), set()
    validator = None
    for directory in sorted(store.root.iterdir()):
        if not directory.is_dir():
            continue  # metadata.json / optional annotations.json belong at root.
        try:
            person = validate_person_id(directory.name)
        except CollectionError:
            summary['structure_issues'].append('NON_ANONYMOUS_OR_INVALID_IDENTITY_DIRECTORY')
            continue  # Do not print private directory names.
        store.checked_path(person)
        summary['identities'] += 1
        if {entry.name for entry in directory.iterdir()} != {'reference', 'webcam'}:
            summary['structure_issues'].append(f'{person}: EXPECTED_REFERENCE_AND_WEBCAM_DIRECTORIES')
        counts, valid_counts = Counter(), Counter()
        for kind in ('reference', 'webcam'):
            folder = store.checked_path(Path(person) / kind)
            if not folder.is_dir():
                summary['structure_issues'].append(f'{person}: MISSING_{kind.upper()}')
                continue
            for path in sorted(folder.iterdir()):
                path = store.checked_path(path.relative_to(store.root))
                if not path.is_file():
                    summary['structure_issues'].append(f'{person}: NON_FILE_IN_{kind.upper()}')
                    continue
                relative = path.relative_to(store.root).as_posix()
                counts[kind] += 1
                summary[f'{kind}_images'] += 1
                summary['total_images'] += 1
                if validator is None:
                    validator = validator_factory()
                content = validator.read(path)
                digest = file_sha256(path)
                if digest in seen_hashes:
                    summary['duplicate_image_contents'] += 1
                seen_hashes.add(digest)
                seen_files.add(relative)
                row = indexed.get(relative)
                if row is None:
                    summary['images_without_metadata'] += 1
                elif row['sha256'] != digest:
                    summary['stale_metadata_rows'] += 1
                elif kind == 'webcam':
                    summary['capture_label_counts'][row['capture_label']] += 1
                try:
                    validator.inspect(content)
                    summary['valid'] += 1
                    valid_counts[kind] += 1
                except ImageRejected as exc:
                    if exc.code not in IMAGE_ERRORS:
                        raise CollectionError('Unexpected quality error; summary stopped.') from exc
                    summary['rejected'] += 1
                    summary['rejection_counts'][exc.code] += 1
        if counts['reference'] != 1:
            summary['structure_issues'].append(f'{person}: NEED_EXACTLY_ONE_REFERENCE')
        if counts['webcam'] < 3:
            summary['structure_issues'].append(f'{person}: NEED_AT_LEAST_THREE_WEBCAM_IMAGES')
        if counts['reference'] == valid_counts['reference'] == 1 and valid_counts['webcam'] >= 3:
            summary['complete_identities'] += 1
        else:
            summary['incomplete_identities'] += 1
    summary['stale_metadata_rows'] += len(set(indexed) - seen_files)
    if summary['identities']:
        summary['average_webcam_images_per_identity'] = summary['webcam_images'] / summary['identities']
    summary['status'] = (
        'COLLECTION_NEEDS_REVIEW' if summary['structure_issues'] or summary['rejected'] or summary['duplicate_image_contents'] or summary['stale_metadata_rows'] else
        'DATASET_INSUFFICIENT' if summary['complete_identities'] < 10 else
        'READY_FOR_PREPARATION'
    )
    summary['coverage_note'] = 'Capture labels are operator prompts, not verified pose/lighting classifications. No demographic inference is performed.'
    summary['statistical_note'] = 'Ten identities is a prototype collection minimum, not proof of low FAR. Prefer 20–30 or 50+ and inspect split-level coverage.'
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', type=Path, default=DEFAULT_DATASET)
    parser.add_argument('--json', action='store_true', help='Print anonymous JSON summary to stdout.')
    args = parser.parse_args(argv)
    summary = summarize_dataset(args.dataset)
    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        for label, key in (('Identities', 'identities'), ('Reference images', 'reference_images'),
                           ('Webcam images', 'webcam_images'), ('Valid', 'valid'), ('Rejected', 'rejected'),
                           ('Complete identities (1 reference + >=3 valid webcams)', 'complete_identities')):
            print(f'{label}: {summary[key]}')
        for code, count in summary['rejection_counts'].items():
            print(f'{code}: {count}')
        print(f"Status: {summary['status']}")
        if summary['structure_issues']:
            print('Structure issues: ' + '; '.join(summary['structure_issues']))
        print('Use --json for metadata, duplicate and collection-label coverage details.')
        print('Collection counts do not establish statistical reliability. No images were changed.')
    return 0 if summary['status'] == 'READY_FOR_PREPARATION' else 2


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, ImportError) as exc:
        raise SystemExit(f'Dataset summary stopped: {exc}') from None
    except OSError:
        raise SystemExit('Dataset summary stopped: local file access failed; check permissions and paths.') from None
