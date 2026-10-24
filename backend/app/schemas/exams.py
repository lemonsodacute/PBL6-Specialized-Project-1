from datetime import datetime
from decimal import Decimal
from uuid import UUID
from pydantic import BaseModel
from app.models.entities import ExamStatus

class ExamCreate(BaseModel):
    title: str; description: str | None = None; start_time: datetime; end_time: datetime; duration_minutes: int
    shuffle_questions: bool = False; shuffle_options: bool = False; allow_review: bool = True; max_attempts: int = 1
    passing_score: Decimal | None = None; require_camera: bool = False; require_fullscreen: bool = True
class ExamUpdate(BaseModel):
    title: str | None = None; description: str | None = None; status: ExamStatus | None = None
    start_time: datetime | None = None; end_time: datetime | None = None; duration_minutes: int | None = None

