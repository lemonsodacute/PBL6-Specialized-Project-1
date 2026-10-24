import base64
import binascii
import re
from pathlib import Path
from uuid import uuid4


UPLOAD_DIR = Path(__file__).resolve().parents[2] / 'uploads'
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024


def save_snapshot(value: str | None) -> str | None:
    if not value or not value.startswith('data:image/'):
        return value
    match = re.match(r'^data:(image/[^;]+);base64,(.+)$', value, re.DOTALL)
    if not match:
        return None
    mime, encoded = match.groups()
    try:
        content = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        return None
    extension = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}.get(mime)
    if extension is None or len(content) > MAX_SNAPSHOT_BYTES:
        return None
    filename = f'{uuid4().hex}.{extension}'
    (UPLOAD_DIR / filename).write_bytes(content)
    return f'/uploads/{filename}'
