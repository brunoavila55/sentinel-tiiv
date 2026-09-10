import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.validation import validate_hostname, validate_ip_address
from app.models.enums import AssetStatus


class AssetCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    site_id: uuid.UUID
    hostname: str | None = Field(default=None, max_length=255)
    ip_address: str | None = Field(default=None, max_length=45)
    description: str | None = Field(default=None, max_length=2000)
    enabled: bool = True
    # Não é uma coluna de `assets` — é sincronizado contra topology_links
    # (link_type="parent") pelo asset_service, mantendo a topologia como
    # grafo genérico por baixo de uma conveniência de "ativo pai" na UI.
    parent_asset_id: uuid.UUID | None = None

    @field_validator("hostname", mode="before")
    @classmethod
    def _hostname(cls, v: str | None) -> str | None:
        return validate_hostname(v)

    @field_validator("ip_address", mode="before")
    @classmethod
    def _ip(cls, v: str | None) -> str | None:
        return validate_ip_address(v)

    @model_validator(mode="after")
    def _require_host_or_ip(self) -> "AssetCreateRequest":
        if not self.hostname and not self.ip_address:
            raise ValueError("informe hostname ou ip_address")
        return self


class AssetUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    site_id: uuid.UUID | None = None
    hostname: str | None = Field(default=None, max_length=255)
    ip_address: str | None = Field(default=None, max_length=45)
    description: str | None = Field(default=None, max_length=2000)
    backup_notes: str | None = Field(default=None, max_length=20000)
    enabled: bool | None = None
    parent_asset_id: uuid.UUID | None = None

    @field_validator("hostname", mode="before")
    @classmethod
    def _hostname(cls, v: str | None) -> str | None:
        return validate_hostname(v)

    @field_validator("ip_address", mode="before")
    @classmethod
    def _ip(cls, v: str | None) -> str | None:
        return validate_ip_address(v)


class AssetOut(BaseModel):
    id: uuid.UUID
    name: str
    hostname: str | None
    ip_address: str | None
    description: str | None
    backup_notes: str | None
    site_id: uuid.UUID
    site_name: str
    parent_asset_id: uuid.UUID | None
    enabled: bool
    status: AssetStatus
    last_rtt_ms: float | None
    packet_loss: float | None
    last_check_at: datetime | None
    # Desde quando o status atual vale — usado pelo frontend pra saber há
    # quanto tempo o ativo está no ar (status="up") ou desde quando ficou
    # offline (status="down"/"warning"), sem expor cada ping individual.
    status_since: datetime | None
    checks_count: int
    photos_count: int
    created_at: datetime
    updated_at: datetime


class AssetListResponse(BaseModel):
    items: list[AssetOut]
    total: int
    limit: int
    offset: int
