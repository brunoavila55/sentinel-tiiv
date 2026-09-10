import uuid
from datetime import datetime

from sqlalchemy import and_, func, or_, select
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
    "fez um teste de ping" a cada checagem bem-sucedida.

    O LAG que compara com o status anterior roda sobre TODO o histórico do
    ativo (sem since/until) — senão o primeiro resultado dentro da janela
    sempre pareceria uma transição (prev_status nulo) mesmo sendo
    continuação do mesmo status de antes do corte. O filtro de since/until
    é aplicado só depois, na query externa, sobre o resultado já marcado."""
    base = select(CheckResult).where(
        CheckResult.organization_id == organization_id, CheckResult.asset_id == asset_id
    )

    prev_status = func.lag(CheckResult.status).over(order_by=CheckResult.checked_at)
    subq = base.add_columns(prev_status.label("prev_status")).subquery()
    row = aliased(CheckResult, subq)

    clauses = [or_(subq.c.prev_status.is_(None), subq.c.prev_status != subq.c.status)]
    if since is not None:
        clauses.append(subq.c.checked_at >= since)
    if until is not None:
        clauses.append(subq.c.checked_at <= until)

    stmt = select(row).where(and_(*clauses)).order_by(row.checked_at.desc()).limit(limit)

    result = await db.execute(stmt)
    return list(result.scalars().all())
