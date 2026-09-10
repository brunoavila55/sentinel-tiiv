import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import can_manage_target_role
from app.core.image_processing import InvalidImageError, validate_image
from app.core.storage import get_storage_service
from app.models.enums import OrganizationRole
from app.models.organization import Organization
from app.models.organization_user import OrganizationUser
from app.repositories import organization_repository
from app.services import audit_service

# Identidade visual da organização: mesmo bucket privado dos asset_photos,
# só que fora do namespace de um ativo específico. Logo tem variante clara
# e escura (a marca pode não ter contraste contra os dois fundos).
_BRANDING_KINDS = ("logo_light", "logo_dark", "favicon")


async def update_name(db: AsyncSession, organization: Organization, name: str) -> Organization:
    organization.name = name
    await db.commit()
    await db.refresh(organization)
    return organization


def build_branding_urls(organization: Organization) -> tuple[str | None, str | None, str | None]:
    """Assina sob demanda a partir de um Organization já resolvido pela
    dependency de tenant atual — nunca a partir de uma storage_key vinda do
    cliente (mesma garantia de isolamento do asset_photo_service).

    Retorna (logo_light_url, logo_dark_url, favicon_url)."""
    storage = get_storage_service()

    def _sign(key: str | None) -> str | None:
        return storage.get_presigned_url(key) if key else None

    return (
        _sign(organization.logo_light_storage_key),
        _sign(organization.logo_dark_storage_key),
        _sign(organization.favicon_storage_key),
    )


def _branding_storage_key(organization_id: uuid.UUID, kind: str, extension: str) -> str:
    return f"organizations/{organization_id}/branding/{kind}/{uuid.uuid4()}.{extension}"


async def _set_branding(
    db: AsyncSession,
    *,
    organization: Organization,
    kind: str,
    content: bytes,
    content_type: str,
    actor_user_id: uuid.UUID,
) -> Organization:
    assert kind in _BRANDING_KINDS

    try:
        extension = validate_image(content, content_type)
    except InvalidImageError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    storage = get_storage_service()
    key = _branding_storage_key(organization.id, kind, extension)
    await storage.upload(key, content, content_type)

    old_key = getattr(organization, f"{kind}_storage_key")
    setattr(organization, f"{kind}_storage_key", key)
    await audit_service.record(
        db,
        organization_id=organization.id,
        user_id=actor_user_id,
        action=f"organization.{kind}_updated",
        entity_type="organization",
        entity_id=organization.id,
        metadata={},
    )
    await db.commit()
    await db.refresh(organization)

    # Só remove o objeto antigo depois que a troca da referência no banco
    # foi confirmada, para nunca deixar a organização apontando para uma
    # chave já apagada se o commit falhar.
    if old_key:
        await storage.delete(old_key)

    return organization


async def upload_logo_light(
    db: AsyncSession, organization: Organization, *, content: bytes, content_type: str, actor_user_id: uuid.UUID
) -> Organization:
    return await _set_branding(
        db, organization=organization, kind="logo_light", content=content, content_type=content_type,
        actor_user_id=actor_user_id,
    )


async def upload_logo_dark(
    db: AsyncSession, organization: Organization, *, content: bytes, content_type: str, actor_user_id: uuid.UUID
) -> Organization:
    return await _set_branding(
        db, organization=organization, kind="logo_dark", content=content, content_type=content_type,
        actor_user_id=actor_user_id,
    )


async def upload_favicon(
    db: AsyncSession, organization: Organization, *, content: bytes, content_type: str, actor_user_id: uuid.UUID
) -> Organization:
    return await _set_branding(
        db, organization=organization, kind="favicon", content=content, content_type=content_type,
        actor_user_id=actor_user_id,
    )


async def _remove_branding(
    db: AsyncSession, *, organization: Organization, kind: str, actor_user_id: uuid.UUID
) -> Organization:
    assert kind in _BRANDING_KINDS

    old_key = getattr(organization, f"{kind}_storage_key")
    if old_key is None:
        return organization

    setattr(organization, f"{kind}_storage_key", None)
    await audit_service.record(
        db,
        organization_id=organization.id,
        user_id=actor_user_id,
        action=f"organization.{kind}_removed",
        entity_type="organization",
        entity_id=organization.id,
        metadata={},
    )
    await db.commit()
    await db.refresh(organization)

    storage = get_storage_service()
    await storage.delete(old_key)
    return organization


async def remove_logo_light(db: AsyncSession, organization: Organization, *, actor_user_id: uuid.UUID) -> Organization:
    return await _remove_branding(db, organization=organization, kind="logo_light", actor_user_id=actor_user_id)


async def remove_logo_dark(db: AsyncSession, organization: Organization, *, actor_user_id: uuid.UUID) -> Organization:
    return await _remove_branding(db, organization=organization, kind="logo_dark", actor_user_id=actor_user_id)


async def remove_favicon(db: AsyncSession, organization: Organization, *, actor_user_id: uuid.UUID) -> Organization:
    return await _remove_branding(db, organization=organization, kind="favicon", actor_user_id=actor_user_id)


async def _guard_last_owner(db: AsyncSession, organization_id: uuid.UUID, target: OrganizationUser) -> None:
    if target.role != OrganizationRole.OWNER:
        return
    owners = await organization_repository.count_owners(db, organization_id)
    if owners <= 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "A organização precisa de ao menos um owner")


async def change_member_role(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    actor_membership: OrganizationUser,
    target_user_id: uuid.UUID,
    new_role: OrganizationRole,
) -> OrganizationUser:
    target = await organization_repository.get_member_by_user_id(db, organization_id, target_user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Membro não encontrado")

    if not can_manage_target_role(actor_membership.role, target.role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Você não pode alterar este usuário")
    if not can_manage_target_role(actor_membership.role, new_role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Você não pode atribuir esta role")

    if target.role != new_role:
        await _guard_last_owner(db, organization_id, target)

    old_role = target.role
    target.role = new_role
    await audit_service.record(
        db,
        organization_id=organization_id,
        user_id=actor_membership.user_id,
        action="user.role_changed",
        entity_type="user",
        entity_id=target_user_id,
        metadata={"old_role": old_role.value, "new_role": new_role.value},
    )
    await db.commit()
    await db.refresh(target)
    return target


async def remove_member(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    actor_membership: OrganizationUser,
    target_user_id: uuid.UUID,
) -> None:
    target = await organization_repository.get_member_by_user_id(db, organization_id, target_user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Membro não encontrado")

    if not can_manage_target_role(actor_membership.role, target.role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Você não pode remover este usuário")

    await _guard_last_owner(db, organization_id, target)

    await db.delete(target)
    await audit_service.record(
        db,
        organization_id=organization_id,
        user_id=actor_membership.user_id,
        action="user.removed",
        entity_type="user",
        entity_id=target_user_id,
        metadata={"role": target.role.value},
    )
    await db.commit()
