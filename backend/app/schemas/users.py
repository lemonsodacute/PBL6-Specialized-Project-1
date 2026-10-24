from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, ConfigDict, field_validator
from app.models.entities import UserRole

class IdentityFields(BaseModel):
    model_config = ConfigDict(extra='forbid')
    student_code: str | None = Field(default=None, max_length=64)

    @field_validator('student_code', mode='before')
    @classmethod
    def normalize_code(cls, value):
        if isinstance(value, str):
            value = value.strip().upper()
            if not value:
                raise ValueError('Mã sinh viên không được để trống; dùng null để xóa.')
        return value

    @field_validator('full_name', mode='before', check_fields=False)
    @classmethod
    def normalize_name(cls, value):
        return value.strip() if isinstance(value, str) else value


class UserCreate(IdentityFields):
    full_name: str = Field(min_length=2, max_length=255)
    email: EmailStr; password: str = Field(min_length=8); role: UserRole = UserRole.student; phone: str | None = None
class UserUpdate(IdentityFields):
    full_name: str | None = Field(default=None, min_length=2, max_length=255)
    phone: str | None = None; is_active: bool | None = None; role: UserRole | None = None

    @field_validator('full_name', 'role', 'is_active', mode='before')
    @classmethod
    def reject_explicit_null(cls, value):
        if value is None:
            raise ValueError('Trường này không được nhận null.')
        return value


class IdentityProfileVerify(BaseModel):
    model_config = ConfigDict(extra='forbid')
    identity_profile_version: int = Field(ge=1)
class PasswordReset(BaseModel):
    password: str = Field(min_length=8)
class UserAdminPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID; full_name: str; email: str; role: UserRole; phone: str | None = None
    is_active: bool; last_login_at: datetime | None = None; created_at: datetime; updated_at: datetime
    student_code: str | None = None
    class_name: str | None = None
    identity_profile_status: str
    identity_profile_version: int
    identity_verified_at: datetime | None = None
    identity_verified_by: UUID | None = None
    student_card_status: str
    avatar_url: str | None = None
    avatar_source: str | None = None
    avatar_reference_id: UUID | None = None
    avatar_updated_at: datetime | None = None
