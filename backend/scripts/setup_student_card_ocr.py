"""Explicit provisioning only. Never imported by student request handlers."""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1] / 'models' / 'ocr'
def provision():
    """Pin official Vietnamese/English LSTM data; no request-time downloads."""
    revision = 'e12c65a915945e4c28e237a9b52bc4a8f39a0cec'
    checksums = {
        'vie.traineddata': 'b6b49293d95d0b6dbd8780174627e82c75be957b6f4ed9862155540d6b00bb45',
        'eng.traineddata': '8280aed0782fe27257a68ea10fe7ef324ca0f8d85bd2fd145d1c2b560bcb66ba',
    }
    destination = ROOT / 'tessdata'
    destination.mkdir(parents=True, exist_ok=True)
    for name, expected in checksums.items():
        target = destination / name
        if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == expected:
            continue
        url = f'https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/{revision}/{name}'
        with urllib.request.urlopen(url, timeout=120) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != expected:
            raise RuntimeError('OCR model checksum mismatch')
        temporary = target.with_suffix('.download')
        temporary.write_bytes(data)
        temporary.replace(target)
    (destination / 'manifest.json').write_text(json.dumps({'revision': revision, 'sha256': checksums}), encoding='utf-8')
    print('Prepared pinned offline Vietnamese/English OCR models')


if __name__ == '__main__':
    provision()
