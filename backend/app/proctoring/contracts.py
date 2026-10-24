from datetime import datetime
from enum import Enum
from uuid import UUID
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator
from app.models.entities import SeverityLevel


class EventStatus(str, Enum):
    NEW = 'NEW'
    REVIEWED = 'REVIEWED'
    DISMISSED = 'DISMISSED'
    CONFIRMED = 'CONFIRMED'


class SafeMetadata(BaseModel):
    """Allowlisted summaries only. Raw images/audio, paths, URLs and embeddings are not accepted."""
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    model_version: str | None = Field(default=None, max_length=64)
    label: str | None = Field(default=None, max_length=64)
    inference_ms: float | None = Field(default=None, ge=0, le=60000)
    frame_count: int | None = Field(default=None, ge=1, le=100000)
    browser_type: str | None = Field(default=None, max_length=32)
    browser_violation_id: UUID | None = None


class EvidenceSummary(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    kind: str = Field(default='metadata', pattern='^metadata$')
    timestamp: AwareDatetime | None = None
    bounding_boxes: list[tuple[float, float, float, float]] = Field(default_factory=list, max_length=20)

    @field_validator('bounding_boxes')
    @classmethod
    def valid_boxes(cls, boxes):
        if any(not all(0 <= coordinate <= 1 for coordinate in box) or box[2] < box[0] or box[3] < box[1] for box in boxes):
            raise ValueError('Bounding boxes must be normalized x1,y1,x2,y2 summaries.')
        return boxes


class NormalizedProctorEvent(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    external_id: UUID
    provider: str = Field(pattern='^[a-z][a-z0-9_-]{0,63}$')
    exam_id: UUID
    attempt_id: UUID
    student_id: UUID
    source: str = Field(pattern='^[A-Z][A-Z0-9_]{0,63}$')
    event_type: str = Field(pattern='^[a-z][a-z0-9_]{0,63}$')
    severity: SeverityLevel
    confidence: float | None = Field(default=None, ge=0, le=1)
    occurred_at: AwareDatetime
    first_seen: AwareDatetime | None = None
    last_seen: AwareDatetime | None = None
    message: str = Field(default='', max_length=500)
    metadata: SafeMetadata = Field(default_factory=SafeMetadata)
    evidence: EvidenceSummary | None = None

    @model_validator(mode='after')
    def ordered_times(self):
        first, last = self.first_seen or self.occurred_at, self.last_seen or self.occurred_at
        if first > self.occurred_at or last < self.occurred_at or last < first:
            raise ValueError('first_seen <= occurred_at <= last_seen is required.')
        return self


class ReviewEvent(BaseModel):
    model_config = ConfigDict(extra='forbid')
    status: EventStatus
    expected_version: int = Field(ge=0)
    note: str | None = Field(default=None, max_length=1000)

    @field_validator('status')
    @classmethod
    def human_action(cls, status):
        if status == EventStatus.NEW:
            raise ValueError('NEW is not a review action.')
        return status


class EventPolicy(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    # None is intentionally uncalibrated/disabled, never a production heuristic.
    minimum_duration_ms: int | None = Field(default=None, ge=0, le=3600000)
    maximum_gap_ms: int | None = Field(default=None, gt=0, le=60000)
    cooldown_ms: int | None = Field(default=None, ge=0, le=3600000)
    confidence_threshold: float | None = Field(default=None, ge=0, le=1)
    severity: SeverityLevel = SeverityLevel.low

    @property
    def calibrated(self):
        return all(value is not None for value in (self.minimum_duration_ms, self.maximum_gap_ms, self.cooldown_ms))


class ModelConfig(BaseModel):
    model_config = ConfigDict(extra='forbid')
    enabled: bool = False
    source: str = Field(pattern='^[A-Z][A-Z0-9_]{0,63}$')
    label: str = Field(max_length=80)
    label_map: dict[str, str] = Field(default_factory=dict)
    policies: dict[str, EventPolicy] = Field(default_factory=dict)
    endpoint: str | None = None  # Backend only; never serialized to a student/teacher.
    frame_interval_ms: int | None = Field(default=None, ge=250, le=60000)

    @model_validator(mode='after')
    def safe_mapping(self):
        import re
        if self.source in {'LEGACY','BROWSER','TAB_SWITCH','TEST_SIMULATOR'}:
            raise ValueError('Reserved source')
        if len(self.label_map)>64 or len(self.policies)>64:
            raise ValueError('Too many model labels')
        kinds=set(self.label_map.values()) | set(self.policies)
        if any(not re.fullmatch(r'[a-z][a-z0-9_]{0,63}',kind) for kind in kinds):
            raise ValueError('Invalid normalized event type')
        if any(not label or len(label)>64 for label in self.label_map):
            raise ValueError('Invalid raw model label')
        return self


EVENT_LABELS = {
    'multiple_faces': 'Nhiều khuôn mặt', 'face_not_detected': 'Không thấy khuôn mặt',
    'gaze_away': 'Nhìn ra ngoài', 'head_turned': 'Quay đầu', 'person_left_frame': 'Rời khung hình',
    'object_phone': 'Phát hiện điện thoại', 'audio_voice_detected': 'Âm thanh cần xem xét',
    'tab_switched': 'Chuyển thẻ trình duyệt', 'browser_signal': 'Tín hiệu từ trình duyệt',
}
