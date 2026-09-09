"""Camada central de limites por plano (PROMPT 21).

Objetivo explícito do prompt: arquitetura, não tabela de preços. Os
números abaixo não são definitivos comercialmente — o que importa é que
nenhum outro lugar do código escreve `if organization.plan == "pro":`.
Qualquer decisão baseada em plano passa por aqui.
"""

import uuid
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import asset_photo_repository, asset_repository, organization_repository

DEFAULT_PLAN = "free"


@dataclass(frozen=True)
class PlanLimits:
    max_assets: int | None  # None = ilimitado
    max_users: int | None
    max_storage_bytes: int | None
    history_retention_days: int


PLAN_LIMITS: dict[str, PlanLimits] = {
    "free": PlanLimits(
        max_assets=10, max_users=3, max_storage_bytes=100 * 1024 * 1024, history_retention_days=7
    ),
    "starter": PlanLimits(
        max_assets=50, max_users=10, max_storage_bytes=1024 * 1024 * 1024, history_retention_days=30
    ),
    "pro": PlanLimits(
        max_assets=500, max_users=50, max_storage_bytes=10 * 1024 * 1024 * 1024, history_retention_days=90
    ),
    "business": PlanLimits(
        max_assets=None, max_users=None, max_storage_bytes=None, history_retention_days=365
    ),
}


def get_plan_limits(plan: str) -> PlanLimits:
    return PLAN_LIMITS.get(plan, PLAN_LIMITS[DEFAULT_PLAN])


class EntitlementLimitReached(HTTPException):
    """Erro estruturado (não só uma string) — o frontend consegue montar
    uma mensagem específica ("3/3 ativos no plano free") sem parsear texto."""

    def __init__(self, *, limit_type: str, limit: int, current: int, plan: str) -> None:
        super().__init__(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error": "entitlement_limit_reached",
                "limit_type": limit_type,
                "limit": limit,
                "current": current,
                "plan": plan,
            },
        )


async def _plan_for(db: AsyncSession, organization_id: uuid.UUID) -> str:
    organization = await organization_repository.get_by_id(db, organization_id)
    return organization.plan if organization is not None else DEFAULT_PLAN


async def ensure_can_add_asset(db: AsyncSession, organization_id: uuid.UUID) -> None:
    plan = await _plan_for(db, organization_id)
    limits = get_plan_limits(plan)
    if limits.max_assets is None:
        return
    current = await asset_repository.count_assets(db, organization_id)
    if current >= limits.max_assets:
        raise EntitlementLimitReached(limit_type="assets", limit=limits.max_assets, current=current, plan=plan)


async def ensure_can_add_user(db: AsyncSession, organization_id: uuid.UUID) -> None:
    plan = await _plan_for(db, organization_id)
    limits = get_plan_limits(plan)
    if limits.max_users is None:
        return
    current = await organization_repository.count_members(db, organization_id)
    if current >= limits.max_users:
        raise EntitlementLimitReached(limit_type="users", limit=limits.max_users, current=current, plan=plan)


async def ensure_can_upload_storage(db: AsyncSession, organization_id: uuid.UUID, additional_bytes: int) -> None:
    plan = await _plan_for(db, organization_id)
    limits = get_plan_limits(plan)
    if limits.max_storage_bytes is None:
        return
    current = await asset_photo_repository.sum_storage_bytes(db, organization_id)
    if current + additional_bytes > limits.max_storage_bytes:
        raise EntitlementLimitReached(
            limit_type="storage_bytes", limit=limits.max_storage_bytes, current=current, plan=plan
        )
