import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_membership
from app.models.enums import AssetStatus
from app.models.organization_user import OrganizationUser
from app.schemas.problem import ProblemOut
from app.services import problem_service

router = APIRouter(prefix="/problems", tags=["problems"])


@router.get("", response_model=list[ProblemOut])
async def list_problems(
    site_id: uuid.UUID | None = Query(default=None),
    status_filter: AssetStatus | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
    membership: OrganizationUser = Depends(get_current_membership),
    db: AsyncSession = Depends(get_db),
) -> list[ProblemOut]:
    rows = await problem_service.list_problems(
        db, membership.organization_id, site_id=site_id, status=status_filter, search=search
    )
    return [
        ProblemOut(
            asset_id=asset.id,
            asset_name=asset.name,
            site_name=site_name,
            ip_or_hostname=str(asset.ip_address) if asset.ip_address is not None else (asset.hostname or ""),
            status=asset.status,
            status_since=asset.status_since,
            last_rtt_ms=asset.last_rtt_ms,
            last_check_at=asset.last_check_at,
            message=message,
        )
        for asset, site_name, message in rows
    ]
