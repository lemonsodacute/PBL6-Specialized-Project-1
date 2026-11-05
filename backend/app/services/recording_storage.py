"""Private media boundary. Implement this protocol for another storage backend."""
from pathlib import Path
import re
from typing import Protocol
from app.core.config import get_settings


class RecordingStorage(Protocol):
    def path(self, key: str) -> Path: ...
    def validate(self, key: str) -> int: ...
    def delete(self, key: str) -> None: ...
    def old_keys(self, before: float) -> list[str]: ...


class LocalRecordingStorage:
    def __init__(self, root: Path):
        self.root = root.resolve()

    def path(self, key):
        if not re.fullmatch(r'[0-9a-f-]{36}\.mp4', key):
            raise ValueError('Invalid recording reference')
        target = (self.root / key).resolve()
        if target.parent != self.root:
            raise ValueError('Invalid recording reference')
        return target

    def validate(self, key):
        target = self.path(key)
        size = target.stat().st_size
        with target.open('rb') as media:
            if size < 32 or media.read(12)[4:8] != b'ftyp':
                raise OSError('Invalid MP4 output')
        return size

    def delete(self, key):
        self.path(key).unlink(missing_ok=True)

    def old_keys(self, before):
        return [path.name for path in self.root.glob('*.mp4') if re.fullmatch(r'[0-9a-f-]{36}\.mp4', path.name)
                and path.resolve().parent == self.root and path.is_file() and path.stat().st_mtime < before]


def get_recording_storage() -> RecordingStorage:
    return LocalRecordingStorage(get_settings().RECORDING_STORAGE_ROOT)
