from typing import Any
from uuid import UUID
from pydantic import BaseModel, Field, field_validator
from app.models.entities import DetectionEventType, SeverityLevel, ViolationType
class ViolationCreate(BaseModel):
    type: ViolationType
    severity: SeverityLevel = SeverityLevel.low
    metadata_json: Any = None
    client_occurred_at: str | None = None

class DetectionEventCreate(BaseModel):
    proctoring_session_id: UUID
    event_type: DetectionEventType
    confidence_score: float | None = Field(default=None, ge=0, le=1)
    severity: SeverityLevel = SeverityLevel.low
    snapshot_url: str | None = None
    snapshot: str | None = Field(default=None, max_length=7_000_000)
    metadata_json: Any = None

    @field_validator('snapshot_url')
    @classmethod
    def validate_snapshot_url(cls, value: str | None) -> str | None:
        if value is not None and not (value.startswith('/uploads/') and value.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))):
            raise ValueError('snapshot_url must reference an uploaded image')
        return value

    @field_validator('snapshot')
    @classmethod
    def validate_snapshot(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith(('data:image/jpeg;base64,', 'data:image/png;base64,', 'data:image/webp;base64,')):
            raise ValueError('snapshot must be a jpeg, png, or webp data URL')
        return value
