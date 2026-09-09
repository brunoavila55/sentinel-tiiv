"""Executor de ping com icmplib mockado (PROMPT 23 pede explicitamente:
"Mockar ICMP. Testar: sucesso; timeout; packet loss; exceção; mudança de
status."). Os testes de integração reais (tests/test_monitor_worker.py)
cobrem o caminho feliz e um host inalcançável contra a rede de verdade;
aqui cobrimos os caminhos de exceção que são difíceis/lentos de provocar
de forma confiável só com rede real (resolução de nome, permissão)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import icmplib

from app.models.asset import Asset
from app.models.check import Check
from monitor.executors.ping import execute_ping


def _asset(*, ip_address: str | None = "10.0.0.1", hostname: str | None = None) -> Asset:
    return Asset(name="alvo", ip_address=ip_address, hostname=hostname)


def _check(*, timeout_seconds: int = 1, config: dict | None = None) -> Check:
    return Check(type="ping", timeout_seconds=timeout_seconds, config=config or {"packets": 3})


def _fake_host(*, is_alive: bool, avg_rtt: float = 0.0, packet_loss: float = 0.0) -> SimpleNamespace:
    return SimpleNamespace(is_alive=is_alive, avg_rtt=avg_rtt, packet_loss=packet_loss)


async def test_ping_success() -> None:
    fake_host = _fake_host(is_alive=True, avg_rtt=1.23456, packet_loss=0.0)
    with patch("icmplib.async_ping", new=AsyncMock(return_value=fake_host)) as mocked:
        result = await execute_ping(_asset(), _check())

    assert mocked.await_args.kwargs["count"] == 3
    assert result.success is True
    assert result.latency_ms == 1.23  # arredondado
    assert result.packet_loss == 0.0
    assert result.message is None


async def test_ping_timeout_reports_packet_loss_not_success() -> None:
    fake_host = _fake_host(is_alive=False, packet_loss=1.0)
    with patch("icmplib.async_ping", new=AsyncMock(return_value=fake_host)):
        result = await execute_ping(_asset(), _check())

    assert result.success is False
    assert result.latency_ms is None
    assert result.packet_loss == 100.0
    assert result.message == "Sem resposta ICMP"


async def test_ping_partial_packet_loss_still_alive() -> None:
    fake_host = _fake_host(is_alive=True, avg_rtt=5.0, packet_loss=0.33)
    with patch("icmplib.async_ping", new=AsyncMock(return_value=fake_host)):
        result = await execute_ping(_asset(), _check())

    assert result.success is True
    assert result.packet_loss == 33.0


async def test_ping_name_lookup_error_normalizes_message() -> None:
    with patch("icmplib.async_ping", new=AsyncMock(side_effect=icmplib.exceptions.NameLookupError("bad.host"))):
        result = await execute_ping(_asset(ip_address=None, hostname="bad.host"), _check())

    assert result.success is False
    assert result.message == "Não foi possível resolver o hostname"


async def test_ping_socket_permission_error_normalizes_message() -> None:
    with patch("icmplib.async_ping", new=AsyncMock(side_effect=icmplib.exceptions.SocketPermissionError(True))):
        result = await execute_ping(_asset(), _check())

    assert result.success is False
    assert result.message == "Sem permissão para enviar ICMP (configuração do worker)"


async def test_ping_generic_icmplib_error_normalizes_message_never_raw_exception() -> None:
    with patch("icmplib.async_ping", new=AsyncMock(side_effect=icmplib.exceptions.ICMPSocketError("detalhe interno"))):
        result = await execute_ping(_asset(), _check())

    assert result.success is False
    assert result.message == "Erro de rede ao executar o ping"
    # nunca a exceção Python bruta como mensagem (PROMPT 09).
    assert "detalhe interno" not in (result.message or "")


async def test_ping_uses_packets_from_config() -> None:
    fake_host = _fake_host(is_alive=True, avg_rtt=1.0, packet_loss=0.0)
    with patch("icmplib.async_ping", new=AsyncMock(return_value=fake_host)) as mocked:
        await execute_ping(_asset(), _check(config={"packets": 7}))

    assert mocked.await_args.kwargs["count"] == 7


async def test_ping_without_ip_or_hostname_fails_without_calling_icmplib() -> None:
    with patch("icmplib.async_ping", new=AsyncMock()) as mocked:
        result = await execute_ping(_asset(ip_address=None, hostname=None), _check())

    mocked.assert_not_awaited()
    assert result.success is False
    assert result.message == "Ativo sem IP ou hostname configurado"
