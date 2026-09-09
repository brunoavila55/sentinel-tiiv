import uuid
from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.check_result import CheckResult


async def list_for_asset(
    db: AsyncSession,
    organization_id: uuid.UUID,
    asset_id: uuid.UUID,
    *,
    since: datetime | None,
    until: datetime | None,
    limit: int,
) -> list[CheckResult]:
    """Só transições de status (ex.: up -> down, down -> up), não cada
    ping de rotina — do contrário o histórico do ativo vira um log de
    "fez um teste de ping" a cada checagem bem-sucedida."""
    base = select(CheckResult).where(
        CheckResult.organization_id == organization_id, CheckResult.asset_id == asset_id
    )
    if since is not None:
        base = base.where(CheckResult.checked_at >= since)
    if until is not None:
        base = base.where(CheckResult.checked_at <= until)

    prev_status = func.lag(CheckResult.status).over(order_by=CheckResult.checked_at)
    subq = base.add_columns(prev_status.label("prev_status")).subquery()
    row = aliased(CheckResult, subq)

    stmt = (
        select(row)
        .where(or_(subq.c.prev_status.is_(None), subq.c.prev_status != subq.c.status))
        .order_by(row.checked_at.desc())
        .limit(limit)
    )

    result = await db.execute(stmt)
    return list(result.scalars().all())
