from dataclasses import dataclass
from typing import Protocol

from app.models.asset import Asset
from app.models.check import Check


@dataclass
class CheckExecutionResult:
    success: bool
    latency_ms: float | None
    packet_loss: float | None
    # Mensagem normalizada, nunca uma exceção Python bruta (PROMPT 09).
    message: str | None


class CheckExecutor(Protocol):
    async def __call__(self, asset: Asset, check: Check) -> CheckExecutionResult: ...
