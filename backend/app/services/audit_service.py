"""Auditoria (PROMPT 22).

`record()` é chamado pelos outros services logo após uma mutação relevante,
dentro da mesma transação (antes do commit) — se a operação falhar depois,
o log de auditoria falha junto, nunca fica órfão de um evento que não
aconteceu de verdade.

Nunca colocar senha, token ou segredo em `metadata` — só identificadores e
valores que já não são sensíveis por si só (nome, papel, contagens).
"""

import uuid
from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog
from app.repositories import audit_log_repository


async def record(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    user_id: uuid.UUID | None,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID | None,
    metadata: dict | None = None,
) -> None:
    await audit_log_repository.create(
        db,
        organization_id=organization_id,
        user_id=user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        event_metadata=metadata,
    )


async def list_recent(db: AsyncSession, organization_id: uuid.UUID, *, limit: int = 100) -> Sequence[AuditLog]:
    return await audit_log_repository.list_recent(db, organization_id, limit=limit)
