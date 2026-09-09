import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import Asset
from app.models.site import Site


async def list_sites(
    db: AsyncSession, organization_id: uuid.UUID, *, search: str | None = None
) -> list[tuple[Site, int]]:
    asset_count = func.count(Asset.id).label("asset_count")
    stmt = (
        select(Site, asset_count)
        .outerjoin(Asset, Asset.site_id == Site.id)
        .where(Site.organization_id == organization_id)
        .group_by(Site.id)
        .order_by(Site.name)
    )
    if search:
        pattern = f"%{search.strip().lower()}%"
        stmt = stmt.where(func.lower(Site.name).like(pattern))

    result = await db.execute(stmt)
    return [(row[0], row[1]) for row in result.all()]


async def get_by_id(db: AsyncSession, organization_id: uuid.UUID, site_id: uuid.UUID) -> Site | None:
    result = await db.execute(select(Site).where(Site.id == site_id, Site.organization_id == organization_id))
    return result.scalar_one_or_none()


async def count_assets(db: AsyncSession, site_id: uuid.UUID) -> int:
    result = await db.execute(select(func.count()).select_from(Asset).where(Asset.site_id == site_id))
    return result.scalar_one()


async def create(db: AsyncSession, **fields: object) -> Site:
    site = Site(**fields)
    db.add(site)
    await db.flush()
    return site


async def delete(db: AsyncSession, site: Site) -> None:
    await db.delete(site)
