import icmplib

from app.models.asset import Asset
from app.models.check import Check
from monitor.executors.base import CheckExecutionResult

DEFAULT_PACKETS = 3
MAX_PACKETS = 10


def _resolve_packets(config: dict) -> int:
    raw = config.get("packets", DEFAULT_PACKETS) if isinstance(config, dict) else DEFAULT_PACKETS
    try:
        packets = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_PACKETS
    return max(1, min(packets, MAX_PACKETS))


async def execute_ping(asset: Asset, check: Check) -> CheckExecutionResult:
    target = str(asset.ip_address) if asset.ip_address else asset.hostname
    if not target:
        return CheckExecutionResult(False, None, None, "Ativo sem IP ou hostname configurado")

    packets = _resolve_packets(check.config)

    try:
        # privileged=True usa raw socket (requer CAP_NET_RAW, já concedido
        # ao container do worker no docker-compose — ver Dockerfile.worker).
        host = await icmplib.async_ping(target, count=packets, timeout=check.timeout_seconds, privileged=True)
    except icmplib.exceptions.NameLookupError:
        return CheckExecutionResult(False, None, None, "Não foi possível resolver o hostname")
    except icmplib.exceptions.SocketPermissionError:
        return CheckExecutionResult(False, None, None, "Sem permissão para enviar ICMP (configuração do worker)")
    except icmplib.exceptions.ICMPLibError:
        # Nunca expõe a exceção Python bruta como mensagem ao usuário.
        return CheckExecutionResult(False, None, None, "Erro de rede ao executar o ping")

    packet_loss_pct = round(host.packet_loss * 100, 1)

    if host.is_alive:
        return CheckExecutionResult(True, round(host.avg_rtt, 2), packet_loss_pct, None)

    return CheckExecutionResult(False, None, packet_loss_pct, "Sem resposta ICMP")
