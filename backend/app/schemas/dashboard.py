import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.enums import AssetStatus


class DashboardTotals(BaseModel):
    total: int
    up: int
    warning: int
    down: int
    unknown: int


class DashboardSiteHealth(BaseModel):
    site_id: uuid.UUID
    site_name: str
    total_assets: int
    # None quando o site não tem nenhum ativo ainda (não faz sentido
    # calcular percentual de 0/0).
    up_percentage: float | None


class DashboardActivityEntry(BaseModel):
    asset_id: uuid.UUID
    asset_name: str
    status: AssetStatus
    checked_at: datetime


class DashboardProblem(BaseModel):
    asset_id: uuid.UUID
    asset_name: str
    site_name: str
    status: AssetStatus
    status_since: datetime | None


class DashboardResponse(BaseModel):
    totals: DashboardTotals
    sites: list[DashboardSiteHealth]
    problems: list[DashboardProblem]
    recent_activity: list[DashboardActivityEntry]
