from datetime import datetime
from uuid import UUID
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class LiveClassCreate(BaseModel):
    class_id: UUID
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=5000)
    scheduled_start: datetime
    scheduled_end: datetime

    @field_validator('title')
    @classmethod
    def trim_title(cls, value):
        if not value.strip():
            raise ValueError('Tiêu đề không được để trống')
        return value.strip()

    @model_validator(mode='after')
    def validate_schedule(self):
        if self.scheduled_start.tzinfo is None or self.scheduled_end.tzinfo is None:
            raise ValueError('Thời gian phải có múi giờ')
        if self.scheduled_end <= self.scheduled_start:
            raise ValueError('scheduled_end must be after scheduled_start')
        return self


class ClassroomConnection(BaseModel):
    participant_sid: str = Field(min_length=1, max_length=100, pattern=r'^PA_[a-zA-Z0-9_-]+$')


class ClassroomPolicyPatch(BaseModel):
    chat: bool | None = None
    screen_share: bool | None = None
    unmute: bool | None = None
    waiting_room: bool | None = None
    locked: bool | None = None


class ClassroomAction(BaseModel):
    action: Literal['admit', 'reject', 'admit_all', 'mute', 'mute_all', 'request_unmute', 'remove', 'lower_hand', 'lower_all']
    participant_id: UUID | None = None


class ClassroomHand(BaseModel):
    raised: bool


class ClassroomMessage(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
