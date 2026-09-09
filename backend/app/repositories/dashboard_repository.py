import uuid
from collections.abc import Sequence

from sqlalchemy import func, or_, select
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import Asset
from app.models.check_result import CheckResult
from app.models.enums import AssetStatus
from app.models.site import Site


async def count_assets_by_status(db: AsyncSession, organization_id: uuid.UUID) -> dict[AssetStatus, int]:
    stmt = select(Asset.status, func.count()).where(Asset.organization_id == organization_id).group_by(Asset.status)
    result = await db.execute(stmt)
    return dict(result.all())


async def site_health(db: AsyncSession, organization_id: uuid.UUID) -> Sequence[Row]:
    """Um outer join: sites sem nenhum ativo ainda aparecem, com 0/0 (não
    somem da lista nem quebram a divisão por zero — isso fica pro service)."""
    total_count = func.count(Asset.id)
    up_count = func.count(Asset.id).filter(Asset.status == AssetStatus.UP)
    stmt = (
        select(Site.id, Site.name, total_count, up_count)
        .outerjoin(Asset, Asset.site_id == Site.id)
        .where(Site.organization_id == organization_id)
        .group_by(Site.id, Site.name)
        .order_by(Site.name)
    )
    result = await db.execute(stmt)
    return result.all()


async def recent_activity(db: AsyncSession, organization_id: uuid.UUID, limit: int) -> Sequence[Row]:
    """Só mudanças de status (ex.: up -> down), não cada ping de rotina —
    do contrário todo ativo aparece "fazendo um teste" a cada checagem."""
    prev_status = func.lag(CheckResult.status).over(
        partition_by=CheckResult.asset_id, order_by=CheckResult.checked_at
    )
    subq = (
        select(
            CheckResult.asset_id,
            CheckResult.status,
            CheckResult.checked_at,
            Asset.name.label("asset_name"),
            prev_status.label("prev_status"),
        )
        .join(Asset, Asset.id == CheckResult.asset_id)
        .where(CheckResult.organization_id == organization_id)
        .subquery()
    )
    stmt = (
        select(subq.c.asset_id, subq.c.status, subq.c.checked_at, subq.c.asset_name)
        .where(or_(subq.c.prev_status.is_(None), subq.c.prev_status != subq.c.status))
        .order_by(subq.c.checked_at.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    return result.all()
