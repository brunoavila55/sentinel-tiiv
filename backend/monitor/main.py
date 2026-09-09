"""Monitor worker: busca checks vencidos, executa e registra resultados.

Fluxo (PROMPT 09):
    buscar checks vencidos -> reservar lote -> executar concorrentemente
    -> interpretar resultados -> registrar check_result
    -> atualizar estado do ativo -> calcular next_check_at

A reserva do lote (com next_check_at avançado) já acontece dentro de
`claim_due_checks`, então o cálculo do próximo agendamento não aparece de
novo aqui.
"""

import asyncio
import logging
import time
from datetime import datetime, timezone

from app.core.database import AsyncSessionLocal
from app.core.logging import configure_logging
from app.models.asset import Asset
from app.models.check import Check
from app.models.check_result import CheckResult
from app.services.state_policy import evaluate_state
from monitor.executors import get_executor
from monitor.repository import claim_due_checks

configure_logging("worker")
logger = logging.getLogger("monitor-worker")

POLL_INTERVAL_SECONDS = 5
BATCH_SIZE = 50
# Um host lento/offline não pode bloquear o worker inteiro (PROMPT 09):
# limite de execuções ICMP concorrentes por lote.
MAX_CONCURRENT_CHECKS = 20


async def process_check(semaphore: asyncio.Semaphore, check: Check) -> bool:
    """Processa um check já reservado. Retorna True se processado com sucesso
    (mesmo que o ping tenha falhado — "sucesso" aqui é "não explodiu")."""
    async with semaphore:
        try:
            async with AsyncSessionLocal() as session:
                asset = await session.get(Asset, check.asset_id)
                if asset is None:
                    return False

                executor = get_executor(check.type)
                result = await executor(asset, check)

                now = datetime.now(timezone.utc)
                config = check.config if isinstance(check.config, dict) else {}
                transition = evaluate_state(
                    previous_status=asset.status,
                    success=result.success,
                    latency_ms=result.latency_ms,
                    latency_warning_threshold_ms=config.get("latency_warning_threshold_ms"),
                    consecutive_successes=check.consecutive_successes,
                    consecutive_failures=check.consecutive_failures,
                )

                session.add(
                    CheckResult(
                        organization_id=check.organization_id,
                        check_id=check.id,
                        asset_id=check.asset_id,
                        status=transition.status,
                        latency_ms=result.latency_ms,
                        packet_loss=result.packet_loss,
                        message=result.message,
                        checked_at=now,
                    )
                )

                check_row = await session.get(Check, check.id)
                check_row.consecutive_successes = transition.consecutive_successes
                check_row.consecutive_failures = transition.consecutive_failures
                check_row.last_check_at = now

                if transition.status != asset.status:
                    asset.status_since = now
                asset.status = transition.status
                asset.last_rtt_ms = result.latency_ms
                asset.packet_loss = result.packet_loss
                asset.last_check_at = now

                await session.commit()
            return True
        except Exception:
            logger.exception(
                "falha ao processar check %s",
                check.id,
                extra={"check_id": str(check.id), "asset_id": str(check.asset_id)},
            )
            return False


async def run_batch() -> int:
    async with AsyncSessionLocal() as session:
        checks = await claim_due_checks(session, batch_size=BATCH_SIZE)

    if not checks:
        return 0

    semaphore = asyncio.Semaphore(MAX_CONCURRENT_CHECKS)
    start = time.monotonic()
    results = await asyncio.gather(*(process_check(semaphore, c) for c in checks))
    duration_ms = round((time.monotonic() - start) * 1000, 1)

    succeeded = sum(1 for r in results if r)
    logger.info(
        "checks_processados=%d checks_sucesso=%d checks_falha=%d duracao_lote_ms=%s",
        len(checks),
        succeeded,
        len(checks) - succeeded,
        duration_ms,
    )
    return len(checks)


async def main() -> None:
    logger.info("monitor worker iniciado")
    while True:
        try:
            await run_batch()
        except Exception:
            logger.exception("erro ao buscar/reservar lote de checks")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    asyncio.run(main())
