import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class AssetPhotoOut(BaseModel):
    id: uuid.UUID
    asset_id: uuid.UUID
    filename: str
    mime_type: str
    size_bytes: int
    caption: str | None
    position: int
    is_primary: bool
    url: str
    thumbnail_url: str
    created_at: datetime


class AssetPhotoUpdateRequest(BaseModel):
    caption: str | None = Field(default=None, max_length=500)
    position: int | None = Field(default=None, ge=0)
