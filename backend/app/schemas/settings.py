from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator

class PersonalSettingsPatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    theme: Literal['light', 'dark', 'system'] | None = None
    notification_preferences: dict[str, StrictBool] | None = None
    exam_duration_minutes: int | None = Field(default=None, ge=1, le=1440, strict=True)
    exam_require_camera: StrictBool | None = None
    exam_require_mic: StrictBool | None = None

    @field_validator('theme', 'notification_preferences', mode='before')
    @classmethod
    def non_null(cls, value):
        if value is None:
            raise ValueError('This setting cannot be null')
        return value

class SystemSettingsPatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    exam_duration_minutes: int | None = Field(default=None, ge=1, le=1440, strict=True)
    exam_require_camera: StrictBool | None = None
    exam_require_mic: StrictBool | None = None
    support_text: str | None = Field(default=None, max_length=2000)

    @field_validator('*', mode='before')
    @classmethod
    def non_null(cls, value):
        if value is None: raise ValueError('This setting cannot be null')
        return value

    @field_validator('support_text')
    @classmethod
    def support_not_empty(cls, value):
        if not value.strip(): raise ValueError('Support information must not be empty')
        return value.strip()
