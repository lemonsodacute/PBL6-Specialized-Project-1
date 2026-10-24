import unicodedata
from pydantic import BaseModel, ConfigDict, Field, field_validator


class EmptyRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')


class RejectProfileRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    identity_profile_version: int = Field(ge=1)
    rejection_reason: str = Field(min_length=1, max_length=500)

    @field_validator('rejection_reason', mode='before')
    @classmethod
    def reason(cls, value):
        if isinstance(value, str):
            value = value.strip()
            if any(unicodedata.category(char).startswith('C') for char in value):
                raise ValueError('Nhập lý do bằng văn bản thông thường.')
        return value
