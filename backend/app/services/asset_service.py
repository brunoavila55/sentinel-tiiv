import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import encrypt_secret
from app.models.asset import Asset
from app.models.enums import AssetStatus
from app.repositories import asset_repository, site_repository
from app.repositories.asset_repository import AssetDetailRow
from app.schemas.asset import AssetCreateRequest, AssetUpdateRequest
from app.services import audit_service, entitlement_service, topology_service


async def _ensure_site_in_org(db: AsyncSession, organization_id: uuid.UUID, site_id: uuid.UUID) -> None:
    site = await site_repository.get_by_id(db, organization_id, site_id)
    if site is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site não encontrado")


async def _get_model_or_404(db: AsyncSession, organization_id: uuid.UUID, asset_id: uuid.UUID) -> Asset:
    asset = await asset_repository.get_model(db, organization_id, asset_id)
    if asset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ativo não encontrado")
    return asset


async def list_assets(
    db: AsyncSession,
    organization_id: uuid.UUID,
    *,
    search: str | None,
    site_id: uuid.UUID | None,
    status_filter: AssetStatus | None,
    enabled: bool | None,
    sort: str | None = None,
    limit: int,
    offset: int,
) -> tuple[list[AssetDetailRow], int]:
    rows = await asset_repository.list_assets(
        db,
        organization_id,
        search=search,
        site_id=site_id,
        status=status_filter,
        enabled=enabled,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    total = await asset_repository.count_assets(
        db, organization_id, search=search, site_id=site_id, status=status_filter, enabled=enabled
    )
    return list(rows), total


async def get_asset_detail(db: AsyncSession, organization_id: uuid.UUID, asset_id: uuid.UUID) -> AssetDetailRow:
    row = await asset_repository.get_by_id(db, organization_id, asset_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ativo não encontrado")
    return row


async def create_asset(
    db: AsyncSession, organization_id: uuid.UUID, payload: AssetCreateRequest, actor_user_id: uuid.UUID
) -> AssetDetailRow:
    await _ensure_site_in_org(db, organization_id, payload.site_id)
    await entitlement_service.ensure_can_add_asset(db, organization_id)
    asset = await asset_repository.create(
        db,
        organization_id=organization_id,
        site_id=payload.site_id,
        name=payload.name,
        hostname=payload.hostname,
        ip_address=payload.ip_address,
        description=payload.description,
        enabled=payload.enabled,
    )
    await db.flush()
    await audit_service.record(
        db,
        organization_id=organization_id,
        user_id=actor_user_id,
        action="asset.created",
        entity_type="asset",
        entity_id=asset.id,
        metadata={"name": asset.name},
    )
    if payload.parent_asset_id is not None:
        await topology_service.sync_parent(
            db, organization_id, asset.site_id, asset.id, payload.parent_asset_id, actor_user_id
        )
    await db.commit()
    return await get_asset_detail(db, organization_id, asset.id)


async def update_asset(
    db: AsyncSession,
    organization_id: uuid.UUID,
    asset_id: uuid.UUID,
    payload: AssetUpdateRequest,
    actor_user_id: uuid.UUID,
) -> AssetDetailRow:
    asset = await _get_model_or_404(db, organization_id, asset_id)
    data = payload.model_dump(exclude_unset=True)

    # parent_asset_id não é uma coluna de Asset — é sincronizado à parte
    # contra topology_links, então não pode entrar no setattr genérico abaixo.
    parent_provided = "parent_asset_id" in data
    parent_asset_id = data.pop("parent_asset_id", None)
    site_changed = "site_id" in data

    # credential_password não é uma coluna de Asset (a coluna guarda o
    # valor criptografado) — trata à parte do setattr genérico abaixo, pra
    # nunca gravar a senha em texto puro.
    credential_password_provided = "credential_password" in data
    credential_password_value = data.pop("credential_password", None)

    if data.get("site_id") is not None:
        await _ensure_site_in_org(db, organization_id, data["site_id"])

    # Valida o estado final ANTES de tocar no objeto rastreado pela sessão:
    # se validarmos depois do setattr, uma exceção aqui deixaria a mutação
    # pendente e suja na sessão (autoflush na próxima query falharia com o
    # mesmo CheckConstraint, num request completamente diferente).
    final_hostname = data.get("hostname", asset.hostname)
    final_ip = data.get("ip_address", asset.ip_address)
    if not final_hostname and not final_ip:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Informe hostname ou IP")

    changed_fields = list(data.keys())
    for field, value in data.items():
        setattr(asset, field, value)

    if credential_password_provided:
        # String vazia/None limpa a credencial; qualquer outro valor é
        # (re)criptografado. O valor em si nunca entra no audit log — só o
        # nome do campo, via `changed_fields`.
        asset.credential_password_encrypted = (
            encrypt_secret(credential_password_value) if credential_password_value else None
        )
        changed_fields.append("credential_password")

    await audit_service.record(
        db,
        organization_id=organization_id,
        user_id=actor_user_id,
        action="asset.updated",
        entity_type="asset",
        entity_id=asset.id,
        metadata={"fields": changed_fields},
    )

    if parent_provided:
        await topology_service.sync_parent(
            db, organization_id, asset.site_id, asset.id, parent_asset_id, actor_user_id
        )
    elif site_changed:
        # Um pai só faz sentido dentro do mesmo site (a topologia é vista
        # por site). Se o ativo mudou de site sem que um novo pai tenha
        # sido informado explicitamente, o vínculo antigo ficaria
        # apontando para um ativo de outro site — melhor limpar do que
        # deixar um link "orfão" silenciosamente incorreto.
        await topology_service.sync_parent(db, organization_id, asset.site_id, asset.id, None, actor_user_id)

    await db.commit()
    return await get_asset_detail(db, organization_id, asset_id)


async def delete_asset(
    db: AsyncSession, organization_id: uuid.UUID, asset_id: uuid.UUID, actor_user_id: uuid.UUID
) -> None:
    asset = await _get_model_or_404(db, organization_id, asset_id)
    asset_name = asset.name
    await asset_repository.delete(db, asset)
    await audit_service.record(
        db,
        organization_id=organization_id,
        user_id=actor_user_id,
        action="asset.deleted",
        entity_type="asset",
        entity_id=asset_id,
        metadata={"name": asset_name},
    )
    await db.commit()
