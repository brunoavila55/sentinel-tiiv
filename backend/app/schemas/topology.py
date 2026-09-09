import uuid
from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from app.models.enums import AssetStatus


class TopologyLinkCreateRequest(BaseModel):
    site_id: uuid.UUID
    source_asset_id: uuid.UUID
    target_asset_id: uuid.UUID
    link_type: str = Field(default="connection", max_length=50)

    @model_validator(mode="after")
    def _no_self_link(self) -> "TopologyLinkCreateRequest":
        if self.source_asset_id == self.target_asset_id:
            raise ValueError("um ativo não pode se conectar a si mesmo")
        return self


class TopologyLinkOut(BaseModel):
    id: uuid.UUID
    source_asset_id: uuid.UUID
    target_asset_id: uuid.UUID
    link_type: str
    created_at: datetime


class TopologyNodeOut(BaseModel):
    id: uuid.UUID
    name: str
    status: AssetStatus
    ip: str | None
    last_rtt_ms: float | None
    site: str
    has_photo: bool


class TopologyResponse(BaseModel):
    nodes: list[TopologyNodeOut]
    edges: list[TopologyLinkOut]
