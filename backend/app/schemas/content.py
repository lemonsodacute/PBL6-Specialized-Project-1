from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.entities import ExamStatus, QuestionDifficulty, QuestionType
from app.services.question_types import SupportedQuestionType

_ANSWER_KEYS = {'correct', 'is_correct', 'correct_answer', 'correct_answer_json', 'answer_key'}


class ContentInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    @model_validator(mode='before')
    @classmethod
    def required_update_values(cls, value):
        # Omitted patch fields remain optional; explicit null must not reach a
        # non-null database column and turn a validation error into HTTP 500.
        required = {'QuestionUpdate': ('content', 'type', 'question_bank_id', 'default_points', 'is_active'),
                    'QuestionBankUpdate': ('name',), 'ClassUpdate': ('name',),
                    'ExamUpdateContent': ('title', 'start_time', 'end_time', 'duration_minutes', 'status', 'max_attempts',
                                          'shuffle_questions', 'shuffle_options', 'allow_review', 'require_camera', 'require_mic', 'require_fullscreen')}
        if isinstance(value, dict) and any(field in value and value[field] is None for field in required.get(cls.__name__, ())):
            raise ValueError('Required fields cannot be null.')
        return value


def validate_exam_period(start, end):
    start = start if start.tzinfo else start.replace(tzinfo=timezone.utc)
    end = end if end.tzinfo else end.replace(tzinfo=timezone.utc)
    if end <= start:
        raise ValueError('End time must be after start time.')

def student_safe_options(value):
    if isinstance(value, dict):
        return {key: student_safe_options(item) for key, item in value.items() if key.lower() not in _ANSWER_KEYS}
    if isinstance(value, list):
        return [student_safe_options(item) for item in value]
    return value


class QuestionImage(BaseModel):
    id: UUID
    page: int | None = None
    position: dict | None = None
    mime_type: str = 'image/png'
    preview_url: str = ''


class QuestionForStudent(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    question_bank_id: UUID
    type: QuestionType
    content: str
    default_points: Decimal
    topic: str | None = None
    difficulty: QuestionDifficulty | None = None
    options_json: object | None = None
    oral_prep_seconds: int | None = None
    oral_answer_seconds: int | None = None
    images: list[QuestionImage] | None = Field(default=None, validation_alias='images_json')

    @model_validator(mode='after')
    def protected_images(self):
        for image in self.images or []:
            image.preview_url = f'/question-images/{self.id}/{image.id}'
        return self


class QuestionForTeacher(QuestionForStudent):
    correct_answer_json: object | None = None
    explanation: str | None = None
    is_active: bool


class QuestionCreate(ContentInput):
    question_bank_id: UUID
    type: SupportedQuestionType
    content: str = Field(min_length=1, max_length=50000)
    default_points: Decimal = Field(default=1, gt=0)
    topic: str | None = Field(default=None, max_length=255)
    difficulty: QuestionDifficulty | None = None
    options_json: object | None = None
    correct_answer_json: object | None = None
    explanation: str | None = None
    is_active: bool = True


class QuestionUpdate(ContentInput):
    question_bank_id: UUID | None = None
    type: SupportedQuestionType | None = None
    content: str | None = Field(default=None, min_length=1, max_length=50000)
    default_points: Decimal | None = Field(default=None, gt=0)
    topic: str | None = Field(default=None, max_length=255)
    difficulty: QuestionDifficulty | None = None
    options_json: object | None = None
    correct_answer_json: object | None = None
    explanation: str | None = None
    is_active: bool | None = None


class QuestionBankCreate(ContentInput):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    subject: str | None = Field(default=None, max_length=255)


class QuestionBankUpdate(QuestionBankCreate):
    name: str | None = Field(default=None, min_length=1, max_length=255)


class ExamCreateContent(ContentInput):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    start_time: datetime
    end_time: datetime
    duration_minutes: int = Field(default=60, gt=0)
    shuffle_questions: bool = False
    shuffle_options: bool = False
    allow_review: bool = True
    max_attempts: int = Field(default=1, gt=0)
    passing_score: Decimal | None = Field(default=None, ge=0)
    require_camera: bool = False
    require_mic: bool = False
    require_fullscreen: bool = True
    violation_auto_lock_threshold: int | None = Field(default=None, ge=0)
    status: ExamStatus = ExamStatus.draft
    extra_settings_json: object | None = None

    @model_validator(mode='after')
    def period(self):
        validate_exam_period(self.start_time, self.end_time)
        return self


class ExamUpdateContent(ContentInput):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    duration_minutes: int | None = Field(default=None, gt=0)
    shuffle_questions: bool | None = None
    shuffle_options: bool | None = None
    allow_review: bool | None = None
    max_attempts: int | None = Field(default=None, gt=0)
    passing_score: Decimal | None = Field(default=None, ge=0)
    require_camera: bool | None = None
    require_mic: bool | None = None
    require_fullscreen: bool | None = None
    violation_auto_lock_threshold: int | None = Field(default=None, ge=0)
    status: ExamStatus | None = None
    extra_settings_json: object | None = None


class ExamQuestionCreate(BaseModel):
    question_id: UUID
    order_index: int = Field(default=0, ge=0)
    points: Decimal = Field(default=1, gt=0)


class RandomQuestionRequest(BaseModel):
    question_bank_id: UUID
    question_type: SupportedQuestionType | None = None
    topic: str | None = None
    difficulty: QuestionDifficulty | None = None
    count: int = Field(gt=0, le=500)
    points_each: Decimal = Field(default=1, gt=0)
    order_start: int = Field(default=0, ge=0)


class ClassCreate(ContentInput):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    homeroom_teacher_id: UUID | None = None


class ClassUpdate(ClassCreate):
    name: str | None = Field(default=None, min_length=1, max_length=255)


class EnrollmentCreate(BaseModel):
    student_id: UUID


class AssignmentCreate(BaseModel):
    class_id: UUID | None = None
    student_id: UUID | None = None

    @model_validator(mode='after')
    def validate_target(self):
        if (self.class_id is None) == (self.student_id is None):
            raise ValueError('Exactly one of class_id or student_id is required')
        return self
