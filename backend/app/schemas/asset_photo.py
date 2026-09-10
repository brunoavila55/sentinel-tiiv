import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# "general" é a galeria principal do ativo (Prompt 08); "backup" é a seção
# de backup do ativo. Fechado por enquanto — nada no domínio hoje precisa
# de mais categorias, mas a coluna é string livre (ver AssetPhoto.category)
# para não exigir migration se isso mudar.
PhotoCategory = Literal["general", "backup"]


class AssetPhotoOut(BaseModel):
    id: uuid.UUID
    asset_id: uuid.UUID
    filename: str
    mime_type: str
    size_bytes: int
    caption: str | None
    position: int
    category: str
    is_primary: bool
    url: str
    thumbnail_url: str
    created_at: datetime


class AssetPhotoUpdateRequest(BaseModel):
    caption: str | None = Field(default=None, max_length=500)
    position: int | None = Field(default=None, ge=0)
