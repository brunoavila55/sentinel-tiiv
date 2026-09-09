from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import Asset
from app.models.check import Check


async def claim_due_checks(db: AsyncSession, *, batch_size: int) -> list[Check]:
    """Reserva um lote de checks vencidos para este worker processar.

    FOR UPDATE SKIP LOCKED: se worker-01 e worker-02 rodarem a mesma query
    ao mesmo tempo, cada um pega checks diferentes — nenhum bloqueia o
    outro esperando lock, e nenhum processa o mesmo check duas vezes.
    `next_check_at` já é adiantado aqui, antes de qualquer ping ser
    executado, para a reserva valer durante toda a janela de execução
    (que pode ser lenta se o host estiver com timeout).
    """
    now = datetime.now(timezone.utc)
    stmt = (
        select(Check)
        .join(Asset, Asset.id == Check.asset_id)
        .where(
            Check.enabled.is_(True),
            Asset.enabled.is_(True),
            Check.next_check_at.is_not(None),
            Check.next_check_at <= now,
        )
        .order_by(Check.next_check_at)
        .limit(batch_size)
        .with_for_update(of=Check, skip_locked=True)
    )
    result = await db.execute(stmt)
    checks = list(result.scalars().all())

    for check in checks:
        check.next_check_at = now + timedelta(seconds=check.interval_seconds)

    await db.commit()
    return checks
