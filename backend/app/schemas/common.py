from typing import Any, Generic, TypeVar
from pydantic import BaseModel, ConfigDict

T = TypeVar('T')

class Meta(BaseModel):
    total: int | None = None
    page: int | None = None
    limit: int | None = None

class ApiResponse(BaseModel, Generic[T]):
    data: T
    meta: Meta

class FromOrm(BaseModel):
    model_config = ConfigDict(from_attributes=True)

