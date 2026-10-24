"""Review drafts map to existing Question fields; source data is preview metadata."""
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class DraftConfiguration(BaseModel):
    model_config = ConfigDict(extra='forbid')
    mode: Literal['import', 'generate']
    count: int = Field(default=20, ge=1, le=100, strict=True)
    question_type: Literal['mcq_single', 'mcq_multi', 'essay'] = 'mcq_single'
    difficulty: Literal['easy', 'medium', 'hard'] = 'medium'
    topic: str | None = Field(default=None, max_length=255)


class DraftQuestion(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: UUID
    # Incomplete extracted questions remain editable; import validates problems().
    content: str = Field(max_length=12000)
    type: Literal['mcq_single', 'mcq_multi', 'essay']
    difficulty: Literal['easy', 'medium', 'hard'] | None = None
    topic: str | None = Field(default=None, max_length=255)
    default_points: Decimal = Field(default=Decimal('1'), gt=0, le=9999.99, decimal_places=2)
    options: list[Annotated[str, Field(max_length=4000)]] = Field(default_factory=list, max_length=12)
    answers: list[Annotated[str, Field(max_length=12000)]] = Field(default_factory=list, max_length=12)
    explanation: str = Field(default='', max_length=12000)
    source_page: int | None = Field(default=None, ge=1)
    source_section: str = Field(default='', max_length=255)
    source_chunk_id: str = Field(default='', max_length=80)
    source_excerpt: str = Field(default='', max_length=6000)
    warnings: list[Annotated[str, Field(max_length=512)]] = Field(default_factory=list, max_length=12)
    duplicate: bool = False
    images: list['DocumentImage'] = Field(default_factory=list, max_length=250)
    warning_codes: list[Literal['IMAGE_REQUIRES_VISION']] = Field(default_factory=list)

    def problems(self) -> list[str]:
        issues = []
        if not self.content.strip():
            issues.append('Chưa có nội dung câu hỏi.')
        if self.type in {'mcq_single', 'mcq_multi'}:
            normalized = [option.strip().casefold() for option in self.options]
            if (len(self.options) < 2 or any(not option or len(option) > 4000 for option in normalized)
                    or len(set(normalized)) != len(normalized)):
                issues.append('Cần ít nhất hai phương án khác nhau, không để trống.')
            if not self.answers or any(answer not in self.options for answer in self.answers):
                issues.append('Chưa chọn đáp án đúng hợp lệ.')
            if len(set(self.answers)) != len(self.answers) or (self.type == 'mcq_single' and len(self.answers) != 1):
                issues.append('Kiểm tra số đáp án đúng của câu hỏi.')
        elif len(self.answers) != 1 or not self.answers[0].strip():
            issues.append('Cần đáp án mẫu hoặc hướng dẫn trả lời.')
        return issues

    def question_values(self) -> dict:
        return {
            'id': self.id, 'content': self.content.strip(), 'type': self.type,
            'difficulty': self.difficulty, 'topic': self.topic.strip() if self.topic else None,
            'default_points': self.default_points,
            'options_json': {'options': self.options} if self.type.startswith('mcq_') else None,
            'correct_answer_json': {'answers': self.answers} if self.type == 'mcq_multi' else {'answer': self.answers[0]},
            'explanation': self.explanation or None, 'is_active': True,
        }


class ImportDrafts(BaseModel):
    model_config = ConfigDict(extra='forbid')
    questions: list[DraftQuestion] = Field(min_length=1, max_length=100)

    @model_validator(mode='after')
    def validate_review(self):
        if len({question.id for question in self.questions}) != len(self.questions):
            raise ValueError('Không chọn trùng một bản nháp.')
        for question in self.questions:
            if question.problems():
                raise ValueError('Câu hỏi chưa đủ nội dung hoặc đáp án. Vui lòng sửa bản nháp.')
        return self


class DocumentImage(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: UUID
    page: int | None = None
    position: dict | None = None
    nearby_paragraph: str = ''
    nearest_section: str = ''
    question_number: int | None = None
    mime_type: str = 'image/png'
    byte_count: int = 0
    temp_url: str = ''


DraftQuestion.model_rebuild()
ImportDrafts.model_rebuild()
