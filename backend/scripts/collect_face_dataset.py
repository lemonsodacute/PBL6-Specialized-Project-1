"""Local, consented reference/webcam collection. No API, DB or network access.

OpenCV headless reads the camera; Tkinter/Pillow display the optional preview.
Importing this module never opens a camera, a window or a model.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
from io import BytesIO
import json
import math
import os
from pathlib import Path
import re
import sys
from uuid import uuid4

if __name__ == '__main__' and __package__ is None:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

DEFAULT_DATASET = Path(__file__).resolve().parents[2] / 'data' / 'face_verification'
CAPTURE_LABELS = ('front_01', 'front_02', 'left', 'right', 'low_light')
PROMPTS = {
    'front_01': 'Nhìn thẳng camera, ánh sáng bình thường.',
    'front_02': 'Nhìn thẳng lần hai, thay đổi nhẹ vị trí hoặc biểu cảm tự nhiên.',
    'left': 'Quay nhẹ sang trái; vẫn để camera thấy rõ khuôn mặt.',
    'right': 'Quay nhẹ sang phải; vẫn để camera thấy rõ khuôn mặt.',
    'low_light': 'Giảm nhẹ ánh sáng, vẫn giữ khuôn mặt nhìn thấy rõ.',
}


class CollectionError(ValueError):
    pass


class ImageRejected(CollectionError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(f'{code}: {message}')


def validate_person_id(person):
    if not isinstance(person, str) or not re.fullmatch(r'person_[0-9]{3,6}', person) or int(person[7:]) == 0:
        raise CollectionError('Use an anonymous ID such as person_001 (3–6 digits, nonzero).')
    return person


def image_relative_path(person, kind, label):
    validate_person_id(person)
    if kind == 'reference' and label == 'reference':
        return Path(person) / 'reference' / 'reference.jpg'
    if kind == 'webcam' and label in CAPTURE_LABELS:
        return Path(person) / 'webcam' / f'{label}.jpg'
    raise CollectionError('Invalid image type or capture label; arbitrary filenames are not accepted.')


class ObservedDetector:
    """Observe the production detector's output without changing its behavior."""
    def __init__(self, detector):
        self.detector = detector
        self.input_size = None
        self.bbox_size = None

    def setInputSize(self, size):
        self.input_size = tuple(size)
        return self.detector.setInputSize(size)

    def detect(self, pixels):
        self.bbox_size = None
        result = self.detector.detect(pixels)
        faces = result[1]
        if getattr(faces, 'shape', None) == (1, 15):
            self.bbox_size = [float(faces[0][2]), float(faces[0][3])]
        return result


class QualityValidator:
    """Use exactly the production decoder and extraction gates, never similarity."""
    def __init__(self):
        from fastapi import HTTPException
        from app.services.face_recognition import FaceEngine, MAX_IMAGE_BYTES

        self._http_exception = HTTPException
        self.max_bytes = MAX_IMAGE_BYTES
        try:
            self.engine = FaceEngine()
        except HTTPException as exc:
            raise CollectionError('MODEL_ERROR: local YuNet/SFace is unavailable.') from exc
        self.observer = ObservedDetector(self.engine.detector)
        self.engine.detector = self.observer

    def read(self, path):
        # Bounded input also lets the production decoder return IMAGE_TOO_LARGE.
        with Path(path).open('rb') as stream:
            return stream.read(self.max_bytes + 1)

    def inspect(self, content):
        try:
            # The returned vector is deliberately discarded, never logged/saved.
            self.engine.extract_embedding(content)
        except self._http_exception as exc:
            detail = exc.detail
            code = detail['code'] if isinstance(detail, dict) else 'MODEL_ERROR'
            if exc.status_code >= 500:
                raise CollectionError(f'{code}: validation model failed; stop collection.') from exc
            raise ImageRejected(code, detail.get('message', 'Image rejected.')) from exc
        width, height = self.observer.input_size
        return {'width': width, 'height': height, 'face_bbox_size': self.observer.bbox_size}

    def prepare(self, content):
        # Reuse the production decoder for EXIF, size limits and thumbnail policy.
        # Store a JPEG copy without EXIF; source files are never modified.
        try:
            frame = self.engine._decode_image(content)
        except self._http_exception as exc:
            if exc.status_code >= 500:
                raise CollectionError('MODEL_ERROR: decoder unavailable.') from exc
            raise ImageRejected(exc.detail['code'], exc.detail['message']) from exc
        output = BytesIO()
        frame.save(output, format='JPEG', quality=95, exif=b'')
        jpeg = output.getvalue()
        # Validate the EXACT bytes to be saved, including JPEG compression effects.
        return jpeg, self.inspect(jpeg)

    def prepare_frame(self, frame):
        cv, np = self.engine.cv, self.engine.np
        if not isinstance(frame, np.ndarray) or frame.dtype != np.uint8 or frame.ndim != 3 or frame.shape[2] != 3:
            raise ImageRejected('INVALID_IMAGE', 'Webcam frame must be BGR uint8.')
        try:
            success, encoded = cv.imencode('.png', frame)
        except cv.error as exc:
            raise ImageRejected('INVALID_IMAGE', 'Unable to encode webcam frame.') from exc
        if not success:
            raise ImageRejected('INVALID_IMAGE', 'Unable to encode webcam frame.')
        return self.prepare(encoded.tobytes())


def validate_metadata(data):
    if not isinstance(data, dict) or set(data) != {'schema_version', 'images'} or data['schema_version'] != 1 or not isinstance(data['images'], list):
        raise CollectionError('Invalid collection metadata schema.')
    filenames = set()
    for row in data['images']:
        required = {'person_id', 'type', 'capture_label', 'filename', 'width', 'height', 'face_bbox_size', 'captured_at', 'sha256'}
        if not isinstance(row, dict) or set(row) != required:
            raise CollectionError('Invalid collection metadata fields; no names or raw embeddings allowed.')
        expected = image_relative_path(row['person_id'], row['type'], row['capture_label']).as_posix()
        if row['filename'] != expected or expected in filenames:
            raise CollectionError('Invalid or duplicate metadata filename.')
        filenames.add(expected)
        if any(type(row[key]) is not int or not 160 <= row[key] <= 1280 for key in ('width', 'height')):
            raise CollectionError('Invalid image dimensions in metadata.')
        bbox = row['face_bbox_size']
        if not isinstance(bbox, list) or len(bbox) != 2 or any(type(v) not in (int, float) or not math.isfinite(v) or v < 80 for v in bbox):
            raise CollectionError('Invalid face bbox size in metadata.')
        if not isinstance(row['sha256'], str) or not re.fullmatch('[a-f0-9]{64}', row['sha256']):
            raise CollectionError('Invalid image checksum in metadata.')
        try:
            stamp = datetime.fromisoformat(row['captured_at'])
            if stamp.tzinfo is None:
                raise ValueError
        except (ValueError, TypeError):
            raise CollectionError('Metadata timestamp must include its timezone.') from None


class DatasetStore:
    """Anonymous filenames, exclusive writes and an atomic metadata index at root."""
    def __init__(self, root):
        root = Path(root)
        if root.is_symlink() or (hasattr(root, 'is_junction') and root.is_junction()):
            raise CollectionError('Dataset root must not be a symbolic link or junction.')
        self.root = root.resolve()

    def checked_path(self, relative):
        path = self.root / relative
        # Reject symlinks and Windows junctions in every existing path component.
        for part in [path, *path.parents]:
            if part == self.root:
                break
            if part.is_symlink() or (hasattr(part, 'is_junction') and part.is_junction()):
                raise CollectionError('Dataset paths must not contain links or junctions.')
        if not path.resolve().is_relative_to(self.root):
            raise CollectionError('Dataset path escapes the selected directory.')
        return path

    def ensure_person(self, person):
        validate_person_id(person)
        self.root.mkdir(parents=True, exist_ok=True)
        for role in ('reference', 'webcam'):
            self.checked_path(Path(person) / role).mkdir(parents=True, exist_ok=True)

    @contextmanager
    def locked(self):
        self.root.mkdir(parents=True, exist_ok=True)
        lock = self.checked_path('.collection.lock')
        try:
            stream = lock.open('x', encoding='utf-8')
        except FileExistsError:
            raise CollectionError('Collection is locked. Close other collectors; after a crash, remove .collection.lock only once no collector is running.') from None
        try:
            stream.write(str(os.getpid()))
            stream.close()
            yield
        finally:
            stream.close()
            lock.unlink(missing_ok=True)

    def metadata(self):
        path = self.checked_path('metadata.json')
        data = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'schema_version': 1, 'images': []}
        validate_metadata(data)
        return data

    def reference_path(self, person):
        validate_person_id(person)
        folder = self.checked_path(Path(person) / 'reference')
        files = list(folder.iterdir()) if folder.is_dir() else []
        expected = self.checked_path(image_relative_path(person, 'reference', 'reference'))
        if files and (len(files) != 1 or files[0] != expected or not expected.is_file()):
            raise CollectionError('Duplicate or noncanonical reference. Keep exactly reference/reference.jpg before using the collector.')
        return expected if expected.is_file() else None

    def probe_labels(self, person):
        validate_person_id(person)
        folder = self.checked_path(Path(person) / 'webcam')
        if folder.exists():
            for file in folder.iterdir():
                if file.name not in {f'{label}.jpg' for label in CAPTURE_LABELS} or not file.is_file():
                    raise CollectionError('Collector expects only its five named JPEG probes in webcam/.')
                self.checked_path(file.relative_to(self.root))
        return [label for label in CAPTURE_LABELS if self.checked_path(image_relative_path(person, 'webcam', label)).is_file()]

    def _atomic_write(self, target, content):
        temporary = self.checked_path(f'.collection-{uuid4().hex}.tmp')
        try:
            with temporary.open('xb') as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)

    def save(self, person, kind, label, jpeg, info, *, confirm_replace=None):
        relative = image_relative_path(person, kind, label)
        if not isinstance(jpeg, bytes) or not jpeg:
            raise CollectionError('No validated JPEG to save.')
        row = {'person_id': person, 'type': kind, 'capture_label': label,
               'filename': relative.as_posix(), **info,
               'captured_at': datetime.now(timezone.utc).isoformat(),
               'sha256': hashlib.sha256(jpeg).hexdigest()}
        validate_metadata({'schema_version': 1, 'images': [row]})
        with self.locked():
            self.ensure_person(person)
            if kind == 'reference':
                self.reference_path(person)  # Refuse a second/ambiguous reference.
            target = self.checked_path(relative)
            data = self.metadata()
            exists = target.exists()
            if exists and (confirm_replace is None or confirm_replace(relative.as_posix()) is not True):
                raise CollectionError('NOT_SAVED: existing image kept; explicit replacement confirmation required.')
            previous = target.read_bytes() if exists else None
            data['images'] = sorted([r for r in data['images'] if r['filename'] != row['filename']] + [row], key=lambda r: r['filename'])
            wrote_image = False
            try:
                if exists:
                    self._atomic_write(target, jpeg)
                else:
                    # Exclusive create protects against a file appearing after checks.
                    with target.open('xb') as stream:
                        wrote_image = True
                        stream.write(jpeg)
                wrote_image = True
                self._atomic_write(self.checked_path('metadata.json'),
                                   (json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False) + '\n').encode('utf-8'))
            except OSError:
                if wrote_image:
                    if previous is None:
                        target.unlink(missing_ok=True)
                    else:
                        self._atomic_write(target, previous)
                raise
        return row


class CaptureSession:
    """Pending captures stay in memory. R/quit never delete a saved photograph."""
    def __init__(self, store, person, validator):
        self.store, self.person, self.validator = store, person, validator
        self.labels = list(CAPTURE_LABELS)
        saved = store.probe_labels(person)
        self.index = next((i for i, name in enumerate(self.labels) if name not in saved), 0)
        self.pending = None
        self.last_saved = None

    @property
    def label(self):
        return self.labels[self.index]

    def select(self, label):
        if label not in self.labels:
            raise CollectionError('Unknown capture label.')
        self.index = self.labels.index(label)
        self.pending = None

    def capture(self, frame):
        self.pending = None
        jpeg, info = self.validator.prepare_frame(frame)
        self.pending = (self.label, jpeg, info)

    def retake(self):
        if self.pending is not None:
            self.pending = None
        elif self.last_saved is not None:
            self.select(self.last_saved)

    def save(self, confirm_replace=None):
        if self.pending is None:
            raise CollectionError('Capture a valid image before saving.')
        label, jpeg, info = self.pending
        row = self.store.save(self.person, 'webcam', label, jpeg, info, confirm_replace=confirm_replace)
        self.last_saved = label
        self.pending = None
        saved = self.store.probe_labels(self.person)
        missing = [i for i, name in enumerate(self.labels) if name not in saved]
        if missing:
            self.index = missing[0]
        return row


def console_confirm(relative):
    return input(f'Replace {relative}? Type YES to confirm: ').strip() == 'YES'


def open_camera(cv, number):
    camera = cv.VideoCapture(number)
    if not camera.isOpened():
        camera.release()
        raise CollectionError('CAMERA_UNAVAILABLE: check OS camera permissions, close other camera apps or choose --camera 1.')
    camera.set(cv.CAP_PROP_FRAME_WIDTH, 1280)
    camera.set(cv.CAP_PROP_FRAME_HEIGHT, 720)
    return camera


def terminal_capture(session, number):
    """Fallback without a display. Continuously drain frames to avoid stale shots."""
    from threading import Event, Lock, Thread
    import time

    camera = open_camera(session.validator.engine.cv, number)
    stop, lock = Event(), Lock()
    latest = [None, None]

    def read_frames():
        while not stop.is_set():
            try:
                ok, frame = camera.read()
            except session.validator.engine.cv.error:
                ok, frame = False, None
            with lock:
                latest[:] = [frame.copy() if ok else None, time.monotonic()]
            if not ok:
                stop.wait(.05)

    reader = Thread(target=read_frames, daemon=True)
    reader.start()
    try:
        print('Terminal: SPACE/Enter capture, S save, R retake, 1–5 select pose, Q quit. Press Enter after commands.')
        while True:
            print(f'{session.label}: {PROMPTS[session.label]}')
            command = input('> ').strip().lower()
            try:
                if command == 'q':
                    break
                if command == 'r':
                    session.retake()
                elif command == 's':
                    row = session.save(console_confirm)
                    print(f"Saved: {row['filename']}")
                elif command in {'1', '2', '3', '4', '5'}:
                    session.select(CAPTURE_LABELS[int(command) - 1])
                elif command in {'', 'c'}:
                    with lock:
                        frame = latest[0].copy() if latest[0] is not None else None
                        timestamp = latest[1]
                    if timestamp is None or time.monotonic() - timestamp > 2:
                        raise CollectionError('CAMERA_FRAME_UNAVAILABLE: wait for a current frame and retry.')
                    session.capture(frame)
                    print('VALID — S saves this image; R discards it for a retake.')
                else:
                    print('Use SPACE/Enter, S, R, 1–5 or Q.')
            except ImageRejected as exc:
                print(f'{exc} Image not saved.')
            except CollectionError as exc:
                if str(exc).startswith('MODEL_ERROR'):
                    raise
                print(str(exc))
    finally:
        session.pending = None
        stop.set()
        reader.join(timeout=2)
        camera.release()


def preview_capture(session, number):
    try:
        import tkinter as tk
        from tkinter import messagebox
        from PIL import Image, ImageTk
    except ImportError:
        raise CollectionError('Preview dependencies unavailable. Run with --no-preview for terminal capture.') from None
    try:
        window = tk.Tk()
    except tk.TclError:
        raise CollectionError('Preview display unavailable. Run with --no-preview.') from None
    window.title(f'Local Face Dataset — {session.person}')
    camera = None
    try:
        camera = open_camera(session.validator.engine.cv, number)
        cv = session.validator.engine.cv
        status = tk.StringVar(value='SPACE chụp · S/Enter lưu · R chụp lại · 1–5 chọn góc · Q thoát')
        prompt = tk.StringVar()
        tk.Label(window, textvariable=prompt, wraplength=800, font=('', 13)).pack(padx=12, pady=8)
        preview = tk.Label(window)
        preview.pack(padx=12)
        tk.Label(window, textvariable=status, wraplength=800).pack(padx=12, pady=8)
        latest = [None]
        failures = [0]
        finished = [False]
        fatal = [None]

        def close():
            finished[0] = True
            session.pending = None
            window.quit()

        def render(image):
            image.thumbnail((880, 560))
            photo = ImageTk.PhotoImage(image)
            preview.configure(image=photo)
            preview.image = photo

        def update():
            if finished[0]:
                return
            prompt.set(f'{session.label} — {PROMPTS[session.label]}')
            try:
                ok, frame = camera.read()
            except cv.error:
                ok, frame = False, None
            latest[0] = frame if ok else None
            failures[0] = 0 if ok else failures[0] + 1
            if failures[0] >= 30:
                fatal[0] = CollectionError('CAMERA_FRAME_UNAVAILABLE: camera stopped delivering frames.')
                close()
                return
            if session.pending is not None:
                with Image.open(BytesIO(session.pending[1])) as frozen:
                    render(frozen.copy())
            elif ok:
                render(Image.fromarray(cv.cvtColor(frame, cv.COLOR_BGR2RGB)))
            else:
                status.set('Đang chờ frame từ camera…')
            window.after(30, update)

        def confirm(relative):
            return messagebox.askyesno('Confirm replacement', f'Replace {relative}? The existing image will be changed.', parent=window)

        def action(event):
            try:
                key = event.keysym.lower()
                if key == 'q':
                    close()
                elif key in {'1', '2', '3', '4', '5'}:
                    session.select(CAPTURE_LABELS[int(key) - 1])
                    status.set('Đã chọn góc. SPACE để chụp.')
                elif key == 'space' and session.pending is None:
                    session.capture(latest[0])
                    status.set('VALID — S/Enter lưu; R bỏ ảnh vừa chụp để thử lại.')
                elif key == 'r':
                    session.retake()
                    status.set('SPACE để chụp lại. Ảnh đã lưu vẫn được giữ đến khi xác nhận thay thế.')
                elif key in {'s', 'return'}:
                    row = session.save(confirm)
                    count = len(session.store.probe_labels(session.person))
                    status.set(f"Đã lưu {row['filename']} ({count}/5). SPACE chụp tiếp; R chụp lại; Q thoát.")
            except ImageRejected as exc:
                status.set(f'{exc} Không lưu ảnh; chỉnh điều kiện rồi nhấn SPACE.')
            except CollectionError as exc:
                if str(exc).startswith('MODEL_ERROR'):
                    fatal[0] = exc
                    close()
                else:
                    status.set(str(exc))
            except OSError:
                fatal[0] = CollectionError('LOCAL_WRITE_FAILED: check disk space and dataset permissions.')
                close()
            return 'break'

        window.bind('<KeyPress>', action)
        window.protocol('WM_DELETE_WINDOW', close)
        window.after(0, update)
        window.mainloop()
        if fatal[0] is not None:
            raise fatal[0]
    finally:
        if camera is not None:
            camera.release()
        window.destroy()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--person', required=True, help='Anonymous ID, e.g. person_001.')
    parser.add_argument('--dataset', type=Path, default=DEFAULT_DATASET)
    parser.add_argument('--reference', type=Path, help='Trusted local JPEG/PNG/WEBP; original is untouched.')
    parser.add_argument('--reference-only', action='store_true', help='Import/validate reference without opening a webcam.')
    parser.add_argument('--camera', type=int, default=0)
    parser.add_argument('--no-preview', action='store_true', help='Terminal capture fallback; no GUI window.')
    parser.add_argument('--consent', action='store_true', help='Operator confirms participant consent for local project experiments.')
    args = parser.parse_args(argv)
    validate_person_id(args.person)
    if args.camera < 0:
        parser.error('Camera index must be nonnegative.')
    if not args.consent and input('Participant consents to local project dataset collection? Type YES: ').strip() != 'YES':
        raise CollectionError('Consent not confirmed; nothing collected.')
    store = DatasetStore(args.dataset)
    store.ensure_person(args.person)
    validator = QualityValidator()
    reference = args.reference
    existing = store.reference_path(args.person)
    if reference is None and existing is None:
        entered = input('Trusted reference image path (Q to cancel): ').strip().strip('"')
        if not entered or entered.lower() == 'q':
            raise CollectionError('Reference required; webcam collection not started.')
        reference = Path(entered)
    if reference is not None:
        if reference.resolve().is_relative_to(store.root):
            raise CollectionError('Choose a trusted source outside this dataset; the source will remain untouched.')
        jpeg, info = validator.prepare(validator.read(reference))
        row = store.save(args.person, 'reference', 'reference', jpeg, info, confirm_replace=console_confirm)
        print(f"Reference saved: {row['filename']}")
    else:
        validator.inspect(validator.read(existing))
        print('Existing reference passed production quality checks.')
    if not args.reference_only:
        session = CaptureSession(store, args.person, validator)
        (terminal_capture if args.no_preview else preview_capture)(session, args.camera)
    count = len(store.probe_labels(args.person))
    print(f'{args.person}: 1 reference, {count} webcam images. ' +
          ('Minimum collection complete; run validate_face_dataset.py.' if count >= 3 else 'INCOMPLETE: collect at least 3 webcam images (recommended 5).'))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, ImportError) as exc:
        raise SystemExit(f'Collection stopped: {exc}') from None
    except OSError:
        raise SystemExit('Collection stopped: local file/camera access failed; check permissions and paths.') from None
    except (KeyboardInterrupt, EOFError):
        raise SystemExit('Collection stopped. Previously saved images are kept; pending captures are discarded.') from None
