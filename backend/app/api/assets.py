import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import ROLES_WRITE_OPERATIONAL, require_role
from app.core.database import get_db
from app.core.dependencies import get_current_membership
from app.models.asset import Asset
from app.models.enums import AssetStatus
from app.models.organization_user import OrganizationUser
from app.repositories.asset_repository import AssetDetailRow
from app.schemas.asset import AssetCreateRequest, AssetListResponse, AssetOut, AssetUpdateRequest
from app.schemas.history import CheckResultOut
from app.services import asset_service, history_service

router = APIRouter(prefix="/assets", tags=["assets"])

MAX_LIMIT = 200


def _asset_out(row: AssetDetailRow) -> AssetOut:
    asset: Asset
    asset, site_name, checks_count, photos_count, parent_asset_id = row
    return AssetOut(
        id=asset.id,
        name=asset.name,
        hostname=asset.hostname,
        ip_address=str(asset.ip_address) if asset.ip_address is not None else None,
        description=asset.description,
        backup_notes=asset.backup_notes,
        site_id=asset.site_id,
        site_name=site_name,
        parent_asset_id=parent_asset_id,
        enabled=asset.enabled,
        status=asset.status,
        last_rtt_ms=asset.last_rtt_ms,
        packet_loss=asset.packet_loss,
        last_check_at=asset.last_check_at,
        status_since=asset.status_since,
        checks_count=checks_count,
        photos_count=photos_count,
        created_at=asset.created_at,
        updated_at=asset.updated_at,
    )


@router.get("", response_model=AssetListResponse)
async def list_assets(
    search: str | None = Query(default=None),
    site_id: uuid.UUID | None = Query(default=None),
    status_filter: AssetStatus | None = Query(default=None, alias="status"),
    enabled: bool | None = Query(default=None),
    sort: str | None = Query(default=None, description="ex.: name, -last_check_at, status, -last_rtt_ms"),
    limit: int = Query(default=50, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    membership: OrganizationUser = Depends(get_current_membership),
    db: AsyncSession = Depends(get_db),
) -> AssetListResponse:
    rows, total = await asset_service.list_assets(
        db,
        membership.organization_id,
        search=search,
        site_id=site_id,
        status_filter=status_filter,
        enabled=enabled,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    return AssetListResponse(items=[_asset_out(row) for row in rows], total=total, limit=limit, offset=offset)


@router.post("", response_model=AssetOut, status_code=status.HTTP_201_CREATED)
async def create_asset(
    payload: AssetCreateRequest,
    membership: OrganizationUser = Depends(require_role(*ROLES_WRITE_OPERATIONAL)),
    db: AsyncSession = Depends(get_db),
) -> AssetOut:
    row = await asset_service.create_asset(db, membership.organization_id, payload, membership.user_id)
    return _asset_out(row)


@router.get("/{asset_id}", response_model=AssetOut)
async def get_asset(
    asset_id: uuid.UUID,
    membership: OrganizationUser = Depends(get_current_membership),
    db: AsyncSession = Depends(get_db),
) -> AssetOut:
    row = await asset_service.get_asset_detail(db, membership.organization_id, asset_id)
    return _asset_out(row)


@router.patch("/{asset_id}", response_model=AssetOut)
async def update_asset(
    asset_id: uuid.UUID,
    payload: AssetUpdateRequest,
    membership: OrganizationUser = Depends(require_role(*ROLES_WRITE_OPERATIONAL)),
    db: AsyncSession = Depends(get_db),
) -> AssetOut:
    row = await asset_service.update_asset(db, membership.organization_id, asset_id, payload, membership.user_id)
    return _asset_out(row)


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_asset(
    asset_id: uuid.UUID,
    membership: OrganizationUser = Depends(require_role(*ROLES_WRITE_OPERATIONAL)),
    db: AsyncSession = Depends(get_db),
) -> None:
    await asset_service.delete_asset(db, membership.organization_id, asset_id, membership.user_id)


@router.get("/{asset_id}/history", response_model=list[CheckResultOut])
async def get_asset_history(
    asset_id: uuid.UUID,
    since: datetime | None = Query(default=None, alias="from"),
    until: datetime | None = Query(default=None, alias="to"),
    limit: int = Query(default=history_service.DEFAULT_LIMIT, ge=1, le=history_service.MAX_LIMIT),
    membership: OrganizationUser = Depends(get_current_membership),
    db: AsyncSession = Depends(get_db),
) -> list[CheckResultOut]:
    results = await history_service.get_history(
        db, membership.organization_id, asset_id, since=since, until=until, limit=limit
    )
    return [
        CheckResultOut(
            id=r.id,
            check_id=r.check_id,
            status=r.status,
            latency_ms=r.latency_ms,
            packet_loss=r.packet_loss,
            message=r.message,
            checked_at=r.checked_at,
        )
        for r in results
    ]
