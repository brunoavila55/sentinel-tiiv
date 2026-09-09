"""Integração do worker (PROMPT 09) contra o banco de teste real.

Roda dentro do container `backend` (via pytest), não do `worker`. Desde o
PROMPT 25 o container `backend` roda como usuário não-root e sem
CAP_NET_RAW (não precisa disso pra nada em produção — só o worker precisa,
e só ele recebe a capability), então os dois testes que dependem do
resultado de um ping de verdade (`test_process_check_success_marks_asset_up`
e `test_process_check_failure_marks_warning_not_down_on_first_loss`) mockam
`icmplib.async_ping`, no mesmo padrão de `tests/test_ping_executor.py` — a
lógica de orquestração (reserva com SKIP LOCKED, execução, política de
estado, gravação de check_results/atualização do ativo) não deve depender
de privilégio de container pra ser testada. A validação de que o container
`worker` (não-root + setcap) consegue mesmo abrir um raw socket foi feita
manualmente contra o serviço `worker` real (ver README).
"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.models.asset import Asset
from app.models.check import Check
from app.models.check_result import CheckResult
from app.models.enums import AssetStatus
from monitor.main import process_check, run_batch
from monitor.repository import claim_due_checks
from tests.factories import create_org_member


def _fake_host(*, is_alive: bool, avg_rtt: float = 0.0, packet_loss: float = 0.0) -> SimpleNamespace:
    return SimpleNamespace(is_alive=is_alive, avg_rtt=avg_rtt, packet_loss=packet_loss)


@pytest_asyncio.fixture(autouse=True)
async def _patch_monitor_session_factory(_test_engine: AsyncEngine) -> AsyncIterator[None]:
    """process_check/run_batch abrem suas próprias sessões via
    monitor.main.AsyncSessionLocal (o factory de produção, que aponta pro
    banco de dev e cujo pool fica preso ao event loop em que foi criado).
    Nos testes isso precisa apontar pro engine de teste — sem isso dá
    "Event loop is closed" no segundo teste que rodar (o pool de produção
    carrega conexões de um event loop de um teste anterior já fechado)."""
    import monitor.main as monitor_main

    original = monitor_main.AsyncSessionLocal
    monitor_main.AsyncSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)
    yield
    monitor_main.AsyncSessionLocal = original


async def _asset_with_check(
    db_session: AsyncSession, *, target_ip: str, org_name: str, timeout_seconds: int = 1
) -> tuple[Asset, Check]:
    from app.models.site import Site

    member = await create_org_member(db_session, org_name=org_name, email=f"owner-{uuid.uuid4().hex[:8]}@example.com")
    site = Site(organization_id=member.organization.id, name="Matriz")
    db_session.add(site)
    await db_session.flush()

    asset = Asset(organization_id=member.organization.id, site_id=site.id, name="alvo", ip_address=target_ip)
    db_session.add(asset)
    await db_session.flush()

    check = Check(
        organization_id=member.organization.id,
        asset_id=asset.id,
        type="ping",
        enabled=True,
        interval_seconds=30,
        timeout_seconds=timeout_seconds,
        config={"packets": 1},
        next_check_at=datetime.now(timezone.utc) - timedelta(seconds=1),
    )
    db_session.add(check)
    await db_session.commit()
    await db_session.refresh(asset)
    await db_session.refresh(check)
    return asset, check


async def test_process_check_success_marks_asset_up(db_session: AsyncSession) -> None:
    asset, check = await _asset_with_check(db_session, target_ip="127.0.0.1", org_name="Org Ping OK")

    fake_host = _fake_host(is_alive=True, avg_rtt=1.5, packet_loss=0.0)
    with patch("icmplib.async_ping", new=AsyncMock(return_value=fake_host)):
        ok = await process_check(asyncio.Semaphore(1), check)
    assert ok is True

    await db_session.refresh(asset)
    assert asset.status == AssetStatus.UP
    assert asset.last_rtt_ms is not None
    assert asset.last_check_at is not None

    results = (
        await db_session.execute(select(CheckResult).where(CheckResult.check_id == check.id))
    ).scalars().all()
    assert len(results) == 1
    assert results[0].status == AssetStatus.UP
    assert results[0].message is None


async def test_process_check_failure_marks_warning_not_down_on_first_loss(db_session: AsyncSession) -> None:
    asset, check = await _asset_with_check(
        db_session, target_ip="10.255.255.1", org_name="Org Ping Fail", timeout_seconds=1
    )

    fake_host = _fake_host(is_alive=False, packet_loss=1.0)
    with patch("icmplib.async_ping", new=AsyncMock(return_value=fake_host)):
        ok = await process_check(asyncio.Semaphore(1), check)
    assert ok is True

    await db_session.refresh(asset)
    assert asset.status == AssetStatus.WARNING
    assert asset.packet_loss == 100.0

    result = (
        await db_session.execute(select(CheckResult).where(CheckResult.check_id == check.id))
    ).scalar_one()
    assert result.message == "Sem resposta ICMP"


async def test_claim_due_checks_reserves_and_advances_next_check_at(db_session: AsyncSession) -> None:
    _, check = await _asset_with_check(db_session, target_ip="127.0.0.1", org_name="Org Claim")

    claimed = await claim_due_checks(db_session, batch_size=10)
    assert [c.id for c in claimed] == [check.id]

    # Reclamar de novo imediatamente não pega o mesmo check: next_check_at
    # já foi empurrado pra frente pela primeira reserva. É esse mecanismo
    # que garante que dois workers concorrentes nunca processam o mesmo
    # check ao mesmo tempo (junto com o FOR UPDATE SKIP LOCKED da query).
    claimed_again = await claim_due_checks(db_session, batch_size=10)
    assert claimed_again == []


async def test_claim_due_checks_ignores_disabled_asset(db_session: AsyncSession) -> None:
    asset, check = await _asset_with_check(db_session, target_ip="127.0.0.1", org_name="Org Disabled")
    asset.enabled = False
    await db_session.commit()

    claimed = await claim_due_checks(db_session, batch_size=10)
    assert claimed == []


async def test_run_batch_processes_end_to_end(db_session: AsyncSession) -> None:
    """Ponta a ponta: run_batch() reserva, executa e grava — sem chamar
    process_check diretamente."""
    _, check = await _asset_with_check(db_session, target_ip="127.0.0.1", org_name="Org Batch")

    processed = await run_batch()

    assert processed == 1

    result_count = (
        await db_session.execute(select(CheckResult).where(CheckResult.check_id == check.id))
    ).scalars().all()
    assert len(result_count) == 1
