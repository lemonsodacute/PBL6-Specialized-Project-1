from uuid import UUID
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.entities import QuestionDifficulty, QuestionType
from app.services.question_types import SupportedQuestionType


class RandomSelectionRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    count: int = Field(gt=0, le=500, strict=True)
    question_type: SupportedQuestionType | None = None
    topic: str | None = None
    difficulty: QuestionDifficulty | None = None
    exclude_ids: list[UUID] = Field(default_factory=list, max_length=5000)
    difficulty_counts: dict[str, Annotated[int, Field(strict=True, ge=0)]] | None = None
    topic_counts: dict[str, Annotated[int, Field(strict=True, ge=0)]] | None = None

    @model_validator(mode='after')
    def validate_groups(self):
        if self.difficulty_counts is not None and self.topic_counts is not None:
            raise ValueError('Choose difficulty or topic distribution, not both')
        groups = self.difficulty_counts if self.difficulty_counts is not None else self.topic_counts
        if groups is not None:
            if not groups or any(not key or type(value) is not int or value < 0 for key, value in groups.items()):
                raise ValueError('Distribution requires named groups and non-negative integer counts')
            if sum(groups.values()) != self.count:
                raise ValueError('Distribution must sum to count')
        if self.difficulty_counts is not None:
            if self.difficulty is not None or set(self.difficulty_counts) - {'easy', 'medium', 'hard'}:
                raise ValueError('Invalid difficulty distribution')
        if self.topic_counts is not None and self.topic is not None:
            raise ValueError('Topic filter cannot be combined with topic distribution')
        return self


class ExamSelectionRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    question_ids: list[UUID] = Field(max_length=500)

    @model_validator(mode='after')
    def no_duplicates(self):
        if len(self.question_ids) != len(set(self.question_ids)):
            raise ValueError('Duplicate question IDs are not allowed')
        return self
