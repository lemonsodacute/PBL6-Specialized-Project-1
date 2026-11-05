from functools import lru_cache
from pathlib import Path
from typing import Literal
from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from app.proctoring.local_policy import local_models

class Settings(BaseSettings):
    DATABASE_URL: str = Field(default='postgresql+psycopg2://postgres:postgres@localhost:5432/ai_proctoring', repr=False)
    JWT_SECRET: str = Field(default='change-me', repr=False)
    JWT_ALGORITHM: str = 'HS256'
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 14
    ENVIRONMENT: str = 'development'
    PROCTOR_MODEL_ENABLED: bool = False
    PROCTOR_GAZE_CALIBRATION: bool = False
    PROCTOR_DIAGNOSTICS: bool = False
    PROCTOR_MODELS: dict = Field(default_factory=local_models)
    PROCTOR_INGEST_KEY: str = Field(default='', repr=False)
    PROCTOR_MODEL_TIMEOUT: float = Field(default=5, ge=.1, le=60)
    PROCTOR_MODEL_HEALTH_TIMEOUT_SECONDS: int = Field(default=60, ge=10, le=3600)
    PROCTOR_INGEST_PER_MINUTE: int = Field(default=120, ge=1, le=600)
    PROCTOR_SIMULATOR_ENABLED: bool = False
    COOKIE_SECURE: bool | None = None
    CORS_ORIGINS: list[str] = ['http://localhost:3000']
    EMAIL_PROVIDER: str = 'console'
    WEBRTC_STUN_SERVERS: str = 'stun:stun.l.google.com:19302'
    LIVEKIT_URL: str = ''  # Public ws(s) URL for classroom clients.
    LIVEKIT_API_URL: str = ''  # Optional internal http(s) URL.
    LIVEKIT_API_KEY: str = ''
    LIVEKIT_API_SECRET: str = Field(default='', repr=False)
    CLASS_RECORDING_ENABLED: bool = False
    LIVEKIT_EGRESS_HEALTH_URL: str = ''
    LIVEKIT_EGRESS_OUTPUT_ROOT: str = '/out'
    RECORDING_STORAGE_ROOT: Path = Path(__file__).resolve().parents[2] / 'private' / 'recordings'
    RECORDING_RETENTION_DAYS: int = Field(default=30, ge=1, le=3650)
    RECORDING_FRAMERATE: int = Field(default=15, ge=5, le=30)
    RECORDING_PLAYBACK_TTL_SECONDS: int = Field(default=300, ge=60, le=900)
    RECORDING_PROCESSING_TIMEOUT_SECONDS: int = Field(default=1800, ge=60, le=86400)
    FACE_MATCH_THRESHOLD: float = Field(default=0.363, gt=0, lt=1)
    CARD_FACE_DEBUG: bool = False
    STUDENT_CARD_OCR_AUTOSTART: bool = True
    STUDENT_CARD_CODE_CHARSET: Literal['numeric', 'alphanumeric'] = 'alphanumeric'
    QUESTION_GENERATION_BASE_URL: str = ''  # Shared OpenAI-compatible root; Gemini endpoint is configured in backend/.env.
    QUESTION_GENERATION_API_KEY: str = Field(default='', repr=False)
    QUESTION_GENERATION_MODEL: str = ''
    SUPPORT_ASSISTANT_MODEL: str = ''  # Model-only override; empty uses QUESTION_GENERATION_MODEL.
    QUESTION_GENERATION_SUPPORTS_VISION: bool = False  # Enable only for a verified vision-capable provider/model.
    QUESTION_GENERATION_TIMEOUT: int = Field(default=90, ge=5, le=180)
    SUPPORT_AI_TIMEOUT: int = Field(default=25, ge=5, le=60)
    SUPPORT_AI_PER_MINUTE: int = Field(default=6, ge=1, le=30)
    SUPPORT_AI_PER_DAY: int = Field(default=100, ge=1, le=1000)
    model_config = SettingsConfigDict(env_file=Path(__file__).resolve().parents[2] / '.env', extra='ignore', hide_input_in_errors=True)

    @model_validator(mode='after')
    def production_secret(self):
        if self.PROCTOR_INGEST_KEY and len(self.PROCTOR_INGEST_KEY) < 32:
            raise ValueError('PROCTOR_INGEST_KEY must have at least 32 characters.')
        if self.ENVIRONMENT.lower() not in {'development', 'test'} and self.PROCTOR_SIMULATOR_ENABLED:
            raise ValueError('The proctor simulator is permitted only in development/test.')
        if self.ENVIRONMENT.lower() in {'production', 'prod'} and (len(self.JWT_SECRET) < 32 or self.JWT_SECRET.lower() in {'change-me', 'secret', 'development-secret'}):
            raise ValueError('Production requires a unique JWT_SECRET with at least 32 characters.')
        if self.ENVIRONMENT.lower() in {'production', 'prod'} and self.COOKIE_SECURE is False:
            raise ValueError('Production requires secure authentication cookies.')
        if self.ENVIRONMENT.lower() in {'production', 'prod'} and '*' in self.CORS_ORIGINS:
            raise ValueError('Production requires explicit CORS origins.')
        return self

    @field_validator('CORS_ORIGINS', mode='before')
    @classmethod
    def parse_origins(cls, value):
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(',') if origin.strip()]
        return value

    @property
    def secure_cookies(self) -> bool:
        return self.COOKIE_SECURE if self.COOKIE_SECURE is not None else self.ENVIRONMENT.lower() in {'production', 'prod'}

@lru_cache
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
