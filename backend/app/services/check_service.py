import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.check import Check
from app.repositories import asset_repository, check_repository
from app.schemas.check import CheckCreateRequest, CheckUpdateRequest
from app.services import audit_service

# Tipos de check suportados hoje. Lista central: adicionar um novo tipo de
# monitoramento (http, tcp, dns, snmp...) começa aqui.
SUPPORTED_CHECK_TYPES = {"ping"}


async def _ensure_asset_in_org(db: AsyncSession, organization_id: uuid.UUID, asset_id: uuid.UUID) -> None:
    asset = await asset_repository.get_model(db, organization_id, asset_id)
    if asset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ativo não encontrado")


async def _get_or_404(
    db: AsyncSession, organization_id: uuid.UUID, asset_id: uuid.UUID, check_id: uuid.UUID
) -> Check:
    check = await check_repository.get_by_id(db, organization_id, asset_id, check_id)
    if check is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Monitoramento não encontrado")
    return check


async def list_checks(db: AsyncSession, organization_id: uuid.UUID, asset_id: uuid.UUID) -> list[Check]:
    await _ensure_asset_in_org(db, organization_id, asset_id)
    return await check_repository.list_for_asset(db, organization_id, asset_id)


async def create_check(
    db: AsyncSession,
    organization_id: uuid.UUID,
    asset_id: uuid.UUID,
    payload: CheckCreateRequest,
    actor_user_id: uuid.UUID,
) -> Check:
    await _ensure_asset_in_org(db, organization_id, asset_id)
    if payload.type not in SUPPORTED_CHECK_TYPES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Tipo de check não suportado: {payload.type}")

    now = datetime.now(timezone.utc)
    check = await check_repository.create(
        db,
        organization_id=organization_id,
        asset_id=asset_id,
        type=payload.type,
        enabled=payload.enabled,
        interval_seconds=payload.interval_seconds,
        timeout_seconds=payload.timeout_seconds,
        # "packets" é o único campo de config que a API expõe hoje —
        # mapeado pra dentro do JSONB genérico aqui, não na borda da API.
        config={"packets": payload.packets},
        # Due imediatamente: não espera um intervalo inteiro pro primeiro check.
        next_check_at=now if payload.enabled else None,
    )
    await db.flush()
    await audit_service.record(
        db,
        organization_id=organization_id,
        user_id=actor_user_id,
        action="check.created",
        entity_type="check",
        entity_id=check.id,
        metadata={"asset_id": str(asset_id), "type": check.type},
    )
    await db.commit()
    await db.refresh(check)
    return check


async def update_check(
    db: AsyncSession,
    organization_id: uuid.UUID,
    asset_id: uuid.UUID,
    check_id: uuid.UUID,
    payload: CheckUpdateRequest,
    actor_user_id: uuid.UUID,
) -> Check:
    check = await _get_or_404(db, organization_id, asset_id, check_id)
    data = payload.model_dump(exclude_unset=True)

    packets = data.pop("packets", None)
    if packets is not None:
        # Preserva outras chaves eventualmente presentes em config (ex.:
        # limiar de latência do Prompt 10, que não tem campo próprio na API).
        check.config = {**(check.config or {}), "packets": packets}

    was_enabled = check.enabled
    changed_fields = list(data.keys()) + (["packets"] if packets is not None else [])
    for field, value in data.items():
        setattr(check, field, value)

    # Reabilitar um check desabilitado: due imediatamente, não espera o
    # next_check_at obsoleto de antes de ter sido desligado.
    if not was_enabled and check.enabled:
        check.next_check_at = datetime.now(timezone.utc)
    elif "enabled" in data and not check.enabled:
        check.next_check_at = None

    # "disabled" é um evento com nome próprio na lista do Prompt 22 — mais
    # específico que um "updated" genérico quando é exatamente isso que
    # mudou.
    action = "check.disabled" if was_enabled and "enabled" in data and not check.enabled else "check.updated"
    await audit_service.record(
        db,
        organization_id=organization_id,
        user_id=actor_user_id,
        action=action,
        entity_type="check",
        entity_id=check.id,
        metadata={"fields": changed_fields},
    )

    await db.commit()
    await db.refresh(check)
    return check


async def delete_check(
    db: AsyncSession, organization_id: uuid.UUID, asset_id: uuid.UUID, check_id: uuid.UUID, actor_user_id: uuid.UUID
) -> None:
    check = await _get_or_404(db, organization_id, asset_id, check_id)
    await check_repository.delete(db, check)
    await audit_service.record(
        db,
        organization_id=organization_id,
        user_id=actor_user_id,
        action="check.deleted",
        entity_type="check",
        entity_id=check_id,
        metadata={"asset_id": str(asset_id)},
    )
    await db.commit()
