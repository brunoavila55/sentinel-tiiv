import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import ROLES_MANAGE_SITES, require_role
from app.core.database import get_db
from app.core.dependencies import get_current_membership
from app.models.organization_user import OrganizationUser
from app.models.site import Site
from app.schemas.site import SiteCreateRequest, SiteOut, SiteUpdateRequest
from app.services import site_service

router = APIRouter(prefix="/sites", tags=["sites"])


def _site_out(site: Site, asset_count: int) -> SiteOut:
    return SiteOut(
        id=site.id,
        name=site.name,
        description=site.description,
        address=site.address,
        asset_count=asset_count,
        created_at=site.created_at,
        updated_at=site.updated_at,
    )


@router.get("", response_model=list[SiteOut])
async def list_sites(
    search: str | None = Query(default=None),
    membership: OrganizationUser = Depends(get_current_membership),
    db: AsyncSession = Depends(get_db),
) -> list[SiteOut]:
    rows = await site_service.list_sites(db, membership.organization_id, search=search)
    return [_site_out(site, count) for site, count in rows]


@router.post("", response_model=SiteOut, status_code=status.HTTP_201_CREATED)
async def create_site(
    payload: SiteCreateRequest,
    membership: OrganizationUser = Depends(require_role(*ROLES_MANAGE_SITES)),
    db: AsyncSession = Depends(get_db),
) -> SiteOut:
    site = await site_service.create_site(db, membership.organization_id, payload, membership.user_id)
    return _site_out(site, 0)


@router.get("/{site_id}", response_model=SiteOut)
async def get_site(
    site_id: uuid.UUID,
    membership: OrganizationUser = Depends(get_current_membership),
    db: AsyncSession = Depends(get_db),
) -> SiteOut:
    site = await site_service.get_site(db, membership.organization_id, site_id)
    count = await site_service.count_assets(db, site_id)
    return _site_out(site, count)


@router.patch("/{site_id}", response_model=SiteOut)
async def update_site(
    site_id: uuid.UUID,
    payload: SiteUpdateRequest,
    membership: OrganizationUser = Depends(require_role(*ROLES_MANAGE_SITES)),
    db: AsyncSession = Depends(get_db),
) -> SiteOut:
    site = await site_service.update_site(db, membership.organization_id, site_id, payload, membership.user_id)
    count = await site_service.count_assets(db, site_id)
    return _site_out(site, count)


@router.delete("/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_site(
    site_id: uuid.UUID,
    membership: OrganizationUser = Depends(require_role(*ROLES_MANAGE_SITES)),
    db: AsyncSession = Depends(get_db),
) -> None:
    await site_service.delete_site(db, membership.organization_id, site_id, membership.user_id)
