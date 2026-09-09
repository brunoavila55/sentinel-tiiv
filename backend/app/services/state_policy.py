"""Máquina de estados dos ativos (PROMPT 10).

Deliberadamente separada do mecanismo de execução dos checks (nenhuma
referência a ICMP/icmplib aqui) — qualquer tipo de check futuro (http, tcp,
dns, snmp, agente) chega aqui como um `success: bool` + `latency_ms`
genéricos.

Modelo (ver CLAUDE.md, PROMPT 10):
    primeiro check ainda não realizado -> unknown
    check saudável                     -> up
    falha inicial ou latência alta     -> warning
    3 falhas consecutivas              -> down
    2 sucessos consecutivos após down  -> up

Os limiares são constantes nomeadas aqui, não números mágicos espalhados
pelo resto do código.
"""

from dataclasses import dataclass

from app.models.enums import AssetStatus

FAILURES_TO_MARK_DOWN = 3
SUCCESSES_TO_RECOVER_FROM_DOWN = 2


@dataclass
class StateTransition:
    status: AssetStatus
    consecutive_successes: int
    consecutive_failures: int


def evaluate_state(
    *,
    previous_status: AssetStatus,
    success: bool,
    latency_ms: float | None,
    latency_warning_threshold_ms: float | None,
    consecutive_successes: int,
    consecutive_failures: int,
) -> StateTransition:
    if success:
        new_successes = consecutive_successes + 1
        new_failures = 0
    else:
        new_successes = 0
        new_failures = consecutive_failures + 1

    high_latency = (
        success and latency_warning_threshold_ms is not None and (latency_ms or 0) > latency_warning_threshold_ms
    )

    if new_failures >= FAILURES_TO_MARK_DOWN:
        new_status = AssetStatus.DOWN
    elif previous_status == AssetStatus.DOWN:
        # Recuperando de DOWN: precisa de sucessos consecutivos, não só um.
        new_status = AssetStatus.UP if new_successes >= SUCCESSES_TO_RECOVER_FROM_DOWN else AssetStatus.DOWN
    elif not success or high_latency:
        new_status = AssetStatus.WARNING
    else:
        new_status = AssetStatus.UP

    return StateTransition(status=new_status, consecutive_successes=new_successes, consecutive_failures=new_failures)
