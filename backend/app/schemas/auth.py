from uuid import UUID
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, EmailStr, ConfigDict, Field, field_validator
from app.models.entities import UserRole
import re


class StudentPhoneUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    phone: str | None

    @field_validator('phone')
    @classmethod
    def validate_phone(cls, value):
        if value is None:
            return None
        value = value.strip()
        if not value:
            return None
        if not re.fullmatch(r'\+?[0-9]{8,15}', value):
            raise ValueError('Số điện thoại cần 8–15 chữ số, có thể bắt đầu bằng +.')
        return value


class SelfProfileUpdate(StudentPhoneUpdate):
    """Only these personal fields may be supplied to the self-service endpoint."""
    phone: str | None = None
    full_name: str | None = Field(default=None, min_length=2, max_length=255)

    @field_validator('full_name', mode='before')
    @classmethod
    def validate_name(cls, value):
        if value is None:
            raise ValueError('Họ và tên không được để trống.')
        return value.strip() if isinstance(value, str) else value

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)

class RegisterRequest(BaseModel):
    # Public registration is student-only; roles are assigned on the server.
    model_config = ConfigDict(extra='forbid')
    full_name: str = Field(min_length=2, max_length=255)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)

    @field_validator('full_name', mode='before')
    @classmethod
    def trim_full_name(cls, value):
        return value.strip() if isinstance(value, str) else value

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=20, max_length=256)
    password: str = Field(min_length=8, max_length=128)

class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID; full_name: str; email: str; role: UserRole


class UserProfile(UserPublic):
    """Current user's profile fields only; no credentials or biometric records."""
    phone: str | None = None
    avatar_url: str | None = None
    avatar_source: Literal['STUDENT_CARD', 'TEACHER_UPLOAD'] | None = None
    avatar_reference_id: UUID | None = None
    avatar_updated_at: datetime | None = None
    is_active: bool
    created_at: datetime
    student_code: str | None = None
    class_name: str | None = None
    identity_profile_status: Literal['PENDING', 'VERIFIED']
    identity_profile_version: int
    identity_verified_at: datetime | None = None
    student_card_status: Literal['NOT_SUBMITTED', 'PENDING_CONFIRMATION', 'VERIFIED', 'NEEDS_REUPLOAD']
