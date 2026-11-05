from pathlib import Path
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

BACKEND = Path(__file__).resolve().parents[1]
MODELS = BACKEND / 'models/proctoring/multitier'
KEY_FILE = BACKEND / 'private/proctor-worker.key'
URL = 'http://127.0.0.1:8765'
LABELS = ('person', 'book', 'cell phone', 'laptop', 'tv', 'headphone', 'smartwatch')


class Raw(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class Detection(Raw):
    class_id: int = Field(ge=0, le=6)
    class_name: str
    confidence: float = Field(ge=0, le=1)
    bbox: tuple[float, float, float, float]  # Normalized xyxy, original frame coordinates.

    @model_validator(mode='after')
    def check_box(self):
        x1, y1, x2, y2 = self.bbox
        if LABELS[self.class_id] != self.class_name or not (0 <= x1 <= x2 <= 1 and 0 <= y1 <= y2 <= 1):
            raise ValueError('Invalid detection')
        return self


class Objects(Raw):
    status: Literal['OK', 'UNAVAILABLE']
    detections: list[Detection] = Field(default_factory=list, max_length=300)


class Gaze(Raw):
    status: Literal['OK', 'UNAVAILABLE']
    face_detected: bool | None = None
    yaw: float | None = Field(default=None, ge=-90, le=90)
    pitch: float | None = Field(default=None, ge=-180, le=180)
    roll: float | None = Field(default=None, ge=-180, le=180)
    gaze_ratio: float | None = Field(default=None, ge=0)
    raw_status: str | None = None

    @model_validator(mode='after')
    def measurements(self):
        if self.status == 'OK':
            if self.face_detected is None or not self.raw_status:
                raise ValueError('Missing face observation')
            if self.face_detected and None in (self.yaw, self.pitch, self.roll, self.gaze_ratio):
                raise ValueError('Incomplete pose')
        return self


class Result(Raw):
    object_detection: Objects | None = None
    gaze: Gaze | None = None
    timings_ms: dict[str, float]


def reference_state(yaw, pitch, ratio):
    if yaw < -18:
        return 'QUAY_SANG_TRAI'
    if yaw > 18:
        return 'QUAY_SANG_PHAI'
    if pitch < -14:
        return 'CUI_XUONG_BAN'
    if pitch > 18:
        return 'NGUA_LEN_TREN'
    if ratio > .63:
        return 'LIEC_SANG_TRAI'
    if ratio < .37:
        return 'LIEC_SANG_PHAI'
    return 'BINH_THUONG'
