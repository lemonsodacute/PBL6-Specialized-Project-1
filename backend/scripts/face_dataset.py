"""Local-only Phase 2 dataset contracts, identity splits and verification pairs.

The manifest contains private relative paths. Reports must only use opaque IDs
and categorical annotations. No image or embedding is written by this module.
"""
from __future__ import annotations

from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import random
import re

SCHEMA_VERSION = 1
PROTOCOL = 'one-trusted-reference-to-one-webcam-v1'
SPLITS = ('train', 'calibration', 'test')
IMAGE_ERRORS = {
    'INVALID_IMAGE', 'IMAGE_TOO_LARGE', 'NO_FACE_DETECTED',
    'MULTIPLE_FACES_DETECTED', 'FACE_TOO_SMALL', 'FACE_TOO_DARK', 'FACE_TOO_BLURRY',
}
ANNOTATIONS = {
    'lighting': {'unknown', 'good', 'dim', 'backlit'},
    'pose': {'unknown', 'front', 'mild_left', 'mild_right', 'large_pose'},
    'glasses': {'unknown', 'yes', 'no'},
    'resolution': {'unknown', 'low', 'normal'},
    'reference_quality': {'unknown', 'original_portrait', 'printed_card', 'glare', 'aged'},
    'device': {'unknown', 'laptop_webcam', 'usb_webcam', 'phone', 'scanner'},
}


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + '\n', encoding='utf-8')


def safe_image_path(root: Path, relative: str) -> Path:
    if not isinstance(relative, str) or not relative or '\\' in relative or ':' in relative:
        raise ValueError('Image paths must be relative POSIX paths inside the dataset.')
    path = PurePosixPath(relative)
    if path.is_absolute() or '..' in path.parts or len(path.parts) != 3:
        raise ValueError('Expected identity/reference|webcam/image relative path.')
    if path.parts[1] not in {'reference', 'webcam'}:
        raise ValueError('Invalid image domain in relative path.')
    root = root.resolve()
    result = root.joinpath(*path.parts).resolve()
    if not result.is_relative_to(root) or not result.is_file():
        raise ValueError('Dataset image missing or outside dataset root.')
    return result


def check_output(root: Path, output: Path) -> None:
    root, output = root.resolve(), output.resolve()
    if output.exists() or output.is_relative_to(root) or root.is_relative_to(output):
        raise ValueError('Choose a NEW output directory outside the source dataset.')


def read_verified_image(root: Path, record: dict) -> bytes:
    content = safe_image_path(root, record['relative_path']).read_bytes()
    if hashlib.sha256(content).hexdigest() != record['sha256']:
        raise ValueError('Dataset changed since validation; create a new manifest and protocol.')
    return content


def validate_annotations(value) -> dict:
    if not isinstance(value, dict) or set(value) - set(ANNOTATIONS):
        raise ValueError('Annotations must contain only documented categorical fields.')
    result = {}
    for key, choices in ANNOTATIONS.items():
        item = value.get(key, 'unknown')
        if not isinstance(item, str) or item not in choices:
            raise ValueError('Invalid annotation category; no free-text identifiers allowed.')
        result[key] = item
    return result


def discover_dataset(root: Path, annotations: dict | None = None) -> list[dict]:
    """Exactly one reference per identity; keep rejected inputs in the protocol."""
    root = root.resolve()
    if not root.is_dir():
        raise ValueError('Dataset directory is missing. Awaiting labeled real-world dataset.')
    annotations = {} if annotations is None else annotations
    if not isinstance(annotations, dict):
        raise ValueError('Annotations must map relative image paths to categorical objects.')
    records, used_annotations, hashes = [], set(), set()
    people = sorted(p for p in root.iterdir() if p.is_dir())
    if not people:
        raise ValueError('Empty dataset. Awaiting labeled real-world dataset.')
    for number, person in enumerate(people, 1):
        if person.is_symlink() or {p.name for p in person.iterdir()} != {'reference', 'webcam'}:
            raise ValueError('Each identity must contain only reference/ and webcam/ directories.')
        for role in ('reference', 'webcam'):
            folder = person / role
            if not folder.is_dir() or folder.is_symlink():
                raise ValueError('Image domains must be local directories.')
            files = sorted(folder.iterdir())
            if not files or (role == 'reference' and len(files) != 1):
                raise ValueError('Each identity needs exactly one reference and at least one webcam image.')
            for path in files:
                if not path.is_file() or path.is_symlink():
                    raise ValueError('Image domains must contain files only, without links or nested directories.')
                relative = path.relative_to(root).as_posix()
                digest = file_sha256(path)
                if digest in hashes:
                    raise ValueError('Duplicate image content across domains or identities; resolve before splitting.')
                hashes.add(digest)
                tags = validate_annotations(annotations.get(relative, {}))
                if relative in annotations:
                    used_annotations.add(relative)
                records.append({
                    'image_id': f'i{len(records) + 1:07d}', 'identity_id': f'p{number:06d}',
                    'role': role, 'relative_path': relative, 'sha256': digest,
                    'status': 'pending', 'annotations': tags,
                })
    if set(annotations) != used_annotations:
        raise ValueError('Annotations contain unknown image paths.')
    return records


def split_identities(records: list[dict], ratios=(0.6, 0.2, 0.2), seed: int = 42) -> list[dict]:
    """Largest-remainder allocation, assigned before quality rejection."""
    if type(seed) is not int:
        raise ValueError('Seed must be an integer.')
    if len(ratios) not in (2, 3) or any(type(r) not in (int, float) or not math.isfinite(r) or r <= 0 for r in ratios):
        raise ValueError('Use two or three positive finite split ratios.')
    if not math.isclose(sum(ratios), 1.0, abs_tol=1e-9):
        raise ValueError('Split ratios must sum to one.')
    identities = sorted({r['identity_id'] for r in records})
    if not identities:
        raise ValueError('Cannot split an empty dataset.')
    random.Random(seed).shuffle(identities)
    exact = [len(identities) * ratio for ratio in ratios]
    counts = [math.floor(n) for n in exact]
    order = sorted(range(len(ratios)), key=lambda i: (-(exact[i] - counts[i]), i))
    for i in order[:len(identities) - sum(counts)]:
        counts[i] += 1
    if min(counts) < 2:
        raise ValueError('Each split needs at least two identities; collect more data or change ratios.')
    mapping, start = {}, 0
    names = SPLITS if len(ratios) == 3 else SPLITS[1:]
    for name, count in zip(names, counts):
        mapping.update({person: name for person in identities[start:start + count]})
        start += count
    result = [{**r, 'split': mapping[r['identity_id']]} for r in records]
    validate_records(result, allow_pending=True)
    return result


def validate_records(records, *, allow_pending=False) -> None:
    if not isinstance(records, list) or not records:
        raise ValueError('Manifest must contain a nonempty images list.')
    ids, paths, hashes, people, folders, person_folders = set(), set(), set(), {}, {}, {}
    domains = defaultdict(Counter)
    allowed_status = IMAGE_ERRORS | {'valid'} | ({'pending'} if allow_pending else set())
    for record in records:
        required = {'image_id', 'identity_id', 'split', 'role', 'relative_path', 'sha256', 'status', 'annotations'}
        if not isinstance(record, dict) or set(record) != required:
            raise ValueError('Invalid image metadata fields.')
        image_id, person = record['image_id'], record['identity_id']
        if not isinstance(image_id, str) or not re.fullmatch(r'i\d{7,}', image_id):
            raise ValueError('Invalid opaque image ID.')
        if not isinstance(person, str) or not re.fullmatch(r'p\d{6,}', person):
            raise ValueError('Invalid opaque identity ID.')
        split, role, status = record['split'], record['role'], record['status']
        if not all(isinstance(v, str) for v in (split, role, status)) or split not in SPLITS or role not in {'reference', 'webcam'} or status not in allowed_status:
            raise ValueError('Invalid split, role or extraction status.')
        if person in people and people[person] != split:
            raise ValueError('Identity leakage across splits.')
        people[person] = split
        relative, digest = record['relative_path'], record['sha256']
        if not isinstance(relative, str) or '\\' in relative or ':' in relative:
            raise ValueError('Invalid relative image path.')
        parts = PurePosixPath(relative).parts
        if len(parts) != 3 or '..' in parts or PurePosixPath(relative).is_absolute() or parts[1] != role:
            raise ValueError('Image path and role do not agree.')
        if parts[0] in folders and folders[parts[0]] != person:
            raise ValueError('One source identity directory has multiple identity labels.')
        if person in person_folders and person_folders[person] != parts[0]:
            raise ValueError('One identity label has multiple source directories.')
        folders[parts[0]] = person
        person_folders[person] = parts[0]
        if not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest):
            raise ValueError('Invalid image checksum.')
        if image_id in ids or relative in paths or digest in hashes:
            raise ValueError('Duplicate image ID, path or content in manifest.')
        ids.add(image_id)
        paths.add(relative)
        hashes.add(digest)
        validate_annotations(record['annotations'])
        domains[person][role] += 1
    if any(count['reference'] != 1 or count['webcam'] < 1 for count in domains.values()):
        raise ValueError('Each identity needs exactly one reference and at least one webcam image.')
    counts = Counter(people.values())
    if any(counts[s] < 2 for s in ('calibration', 'test')) or ('train' in counts and counts['train'] < 2):
        raise ValueError('Each requested split needs at least two distinct identities.')


def load_manifest(path: Path, root: Path) -> dict:
    data = json.loads(path.read_text(encoding='utf-8-sig'))
    if not isinstance(data, dict) or data.get('schema_version') != SCHEMA_VERSION or data.get('protocol') != PROTOCOL:
        raise ValueError('Unsupported dataset manifest schema or protocol.')
    validate_records(data.get('images'))
    for record in data['images']:
        image = safe_image_path(root, record['relative_path'])
        if file_sha256(image) != record['sha256']:
            raise ValueError('Dataset changed since validation; create a new manifest and protocol.')
    return data


def dataset_summary(records: list[dict]) -> dict:
    statuses = Counter(r['status'] for r in records)
    valid = statuses.get('valid', 0)
    return {
        'identities': len({r['identity_id'] for r in records}),
        'reference_images': sum(r['role'] == 'reference' for r in records),
        'webcam_images': sum(r['role'] == 'webcam' for r in records),
        'total_images': len(records), 'valid': valid, 'rejected_images': len(records) - valid,
        'status_counts': dict(sorted(statuses.items())),
        'split_identities': {s: len({r['identity_id'] for r in records if r['split'] == s}) for s in SPLITS},
        'identities_with_fewer_than_3_webcam_images': sum(
            n < 3 for n in Counter(r['identity_id'] for r in records if r['role'] == 'webcam').values()),
        'annotations': {key: dict(Counter(r['annotations'].get(key, 'unknown') for r in records)) for key in ANNOTATIONS},
    }


def generate_pairs(records: list[dict], split: str, *, seed: int = 42, max_impostors: int | None = None):
    """All genuine pairs; uniform sampling without replacement over ALL impostors.

    A probe's possible impostors are the N-1 other references. Index arithmetic
    avoids constructing the quadratic candidate list before sampling.
    Rejected images remain in planned pairs, so failures cannot disappear.
    """
    validate_records(records)
    if split not in SPLITS or type(seed) is not int:
        raise ValueError('Invalid pair split or seed.')
    if max_impostors is not None and (type(max_impostors) is not int or max_impostors < 1):
        raise ValueError('max_impostors must be a positive integer or omitted for all-pairs.')
    references = sorted((r for r in records if r['split'] == split and r['role'] == 'reference'), key=lambda r: r['identity_id'])
    probes = sorted((r for r in records if r['split'] == split and r['role'] == 'webcam'), key=lambda r: r['image_id'])
    if len(references) < 2 or not probes:
        raise ValueError('Pair split needs two identities and webcam images.')
    positions = {r['identity_id']: i for i, r in enumerate(references)}

    def pair(reference, probe, genuine):
        return {
            'pair_id': f"{split}_{reference['image_id']}_{probe['image_id']}",
            'split': split, 'reference_id': reference['image_id'], 'webcam_id': probe['image_id'],
            'genuine': genuine,
        }

    for probe in probes:
        yield pair(references[positions[probe['identity_id']]], probe, True)
    width = len(references) - 1
    total = len(probes) * width
    indices = range(total) if max_impostors is None or max_impostors >= total else sorted(random.Random(seed).sample(range(total), max_impostors))
    for index in indices:
        probe_index, reference_index = divmod(index, width)
        probe = probes[probe_index]
        own = positions[probe['identity_id']]
        if reference_index >= own:
            reference_index += 1
        yield pair(references[reference_index], probe, False)
