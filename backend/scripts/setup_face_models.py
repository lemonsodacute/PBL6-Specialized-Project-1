"""Download the two OpenCV Zoo models and verify their Git LFS SHA-256."""
from hashlib import sha256
from pathlib import Path
from urllib.request import urlopen

DESTINATION = Path(__file__).resolve().parents[1] / 'models' / 'face'
MODELS = (
    ('face_detection_yunet', 'face_detection_yunet_2023mar.onnx'),
    ('face_recognition_sface', 'face_recognition_sface_2021dec.onnx'),
)


def download_models():
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for directory, name in MODELS:
        relative = f'models/{directory}/{name}'
        with urlopen(f'https://raw.githubusercontent.com/opencv/opencv_zoo/main/{relative}', timeout=60) as response:
            pointer = response.read().decode('ascii')
        expected = next(line.removeprefix('oid sha256:') for line in pointer.splitlines() if line.startswith('oid sha256:'))
        destination = DESTINATION / name
        if destination.exists() and sha256(destination.read_bytes()).hexdigest() == expected:
            print(f'OK: {name}')
            continue
        print(f'Downloading {name}...', flush=True)
        with urlopen(f'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/{relative}', timeout=60) as response:
            content = response.read()
        if sha256(content).hexdigest() != expected:
            raise RuntimeError(f'Checksum mismatch: {name}')
        temporary = destination.with_suffix('.download')
        temporary.write_bytes(content)
        temporary.replace(destination)
        with urlopen(f'https://raw.githubusercontent.com/opencv/opencv_zoo/main/models/{directory}/LICENSE', timeout=60) as response:
            (DESTINATION / f'{directory}.LICENSE').write_bytes(response.read())
        print(f'Installed {name} ({len(content):,} bytes)', flush=True)


if __name__ == '__main__':
    download_models()
