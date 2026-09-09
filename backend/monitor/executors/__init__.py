from collections.abc import Callable

from monitor.executors.base import CheckExecutionResult, CheckExecutor
from monitor.executors.ping import execute_ping

# Registry por tipo de check. Adicionar um novo tipo de monitoramento
# (http, tcp, dns, snmp...) é acrescentar uma entrada aqui — o loop
# principal do worker (monitor/main.py) não conhece nenhum tipo específico.
_EXECUTORS: dict[str, CheckExecutor] = {
    "ping": execute_ping,
}


def get_executor(check_type: str) -> Callable:
    executor = _EXECUTORS.get(check_type)
    if executor is None:
        raise ValueError(f"tipo de check não suportado: {check_type}")
    return executor


__all__ = ["CheckExecutionResult", "CheckExecutor", "get_executor"]
