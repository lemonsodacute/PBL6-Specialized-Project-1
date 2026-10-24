import json
from typing import Any
from uuid import UUID
from decimal import Decimal
from pydantic import BaseModel, Field, field_validator, model_validator
class AttemptStart(BaseModel):
    exam_id: UUID
class AnswerSave(BaseModel):
    question_id: UUID
    answer_content: Any = None
    selected_option_ids: list[Any] | None = Field(default=None, max_length=100)

    @field_validator('answer_content')
    @classmethod
    def limit_answer_content(cls, value: Any) -> Any:
        if len(json.dumps(value, ensure_ascii=False, separators=(',', ':'))) > 10_000:
            raise ValueError('answer_content is limited to 10,000 JSON characters')
        return value

    @field_validator('selected_option_ids')
    @classmethod
    def limit_option_ids(cls, value: list[Any] | None) -> list[Any] | None:
        if value is not None and any(len(str(item)) > 200 for item in value):
            raise ValueError('Each selected option id is limited to 200 characters')
        return value

    @model_validator(mode='after')
    def require_answer(self):
        if self.answer_content is None and self.selected_option_ids is None:
            raise ValueError('answer_content or selected_option_ids is required')
        return self

    def content(self) -> Any:
        return self.selected_option_ids if self.selected_option_ids is not None else self.answer_content
class AttemptSubmit(BaseModel):
    pass

class ManualGrade(BaseModel):
    points_awarded: Decimal = Field(ge=0)
