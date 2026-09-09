import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import can_manage_target_role
from app.models.enums import OrganizationRole
from app.models.organization import Organization
from app.models.organization_user import OrganizationUser
from app.repositories import organization_repository
from app.services import audit_service


async def update_name(db: AsyncSession, organization: Organization, name: str) -> Organization:
    organization.name = name
    await db.commit()
    await db.refresh(organization)
    return organization


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
