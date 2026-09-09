import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import ROLES_WRITE_OPERATIONAL, require_role
from app.core.database import get_db
from app.core.dependencies import get_current_membership
from app.models.organization_user import OrganizationUser
from app.models.topology_link import TopologyLink
from app.schemas.topology import TopologyLinkCreateRequest, TopologyLinkOut, TopologyNodeOut, TopologyResponse
from app.services import topology_service

router = APIRouter(prefix="/topology", tags=["topology"])


def _link_out(link: TopologyLink) -> TopologyLinkOut:
    return TopologyLinkOut(
        id=link.id,
        source_asset_id=link.source_asset_id,
        target_asset_id=link.target_asset_id,
        link_type=link.link_type,
        created_at=link.created_at,
    )


@router.get("", response_model=TopologyResponse)
async def get_topology(
    site_id: uuid.UUID = Query(...),
    membership: OrganizationUser = Depends(get_current_membership),
    db: AsyncSession = Depends(get_db),
) -> TopologyResponse:
    site, node_rows, links = await topology_service.get_topology(db, membership.organization_id, site_id)

    nodes = [
        TopologyNodeOut(
            id=asset.id,
            name=asset.name,
            status=asset.status,
            ip=str(asset.ip_address) if asset.ip_address is not None else asset.hostname,
            last_rtt_ms=asset.last_rtt_ms,
            site=site.name,
            has_photo=has_photo,
        )
        for asset, has_photo in node_rows
    ]
    edges = [_link_out(link) for link in links]
    return TopologyResponse(nodes=nodes, edges=edges)


@router.post("/links", response_model=TopologyLinkOut, status_code=status.HTTP_201_CREATED)
async def create_link(
    payload: TopologyLinkCreateRequest,
    membership: OrganizationUser = Depends(require_role(*ROLES_WRITE_OPERATIONAL)),
    db: AsyncSession = Depends(get_db),
) -> TopologyLinkOut:
    link = await topology_service.create_link(db, membership.organization_id, payload, membership.user_id)
    return _link_out(link)


@router.delete("/links/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_link(
    link_id: uuid.UUID,
    membership: OrganizationUser = Depends(require_role(*ROLES_WRITE_OPERATIONAL)),
    db: AsyncSession = Depends(get_db),
) -> None:
    await topology_service.delete_link(db, membership.organization_id, link_id, membership.user_id)
