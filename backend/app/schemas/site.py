import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class SiteCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    address: str | None = Field(default=None, max_length=500)


class SiteUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    address: str | None = Field(default=None, max_length=500)


class SiteOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    address: str | None
    asset_count: int
    created_at: datetime
    updated_at: datetime
