import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import ROLES_MANAGE_ORGANIZATION, ROLES_MANAGE_USERS, can_manage_target_role, require_role
from app.core.config import get_settings
from app.core.database import get_db
from app.core.dependencies import get_current_membership, get_current_organization
from app.models.enums import OrganizationRole
from app.models.organization import Organization
from app.models.organization_invite import OrganizationInvite
from app.models.organization_user import OrganizationUser
from app.repositories import organization_repository
from app.schemas.organization import (
    InviteCreateRequest,
    InviteOut,
    MemberOut,
    MemberRoleUpdateRequest,
    OrganizationOut,
    OrganizationUpdateRequest,
)
from app.services import invite_service, organization_service

router = APIRouter(prefix="/organizations", tags=["organizations"])
settings = get_settings()
logger = logging.getLogger("sentinel.organizations")


@router.get("/current", response_model=OrganizationOut)
async def get_current_organization_route(
    organization: Organization = Depends(get_current_organization),
) -> OrganizationOut:
    return OrganizationOut.model_validate(organization)


@router.patch("/current", response_model=OrganizationOut)
async def update_current_organization(
    payload: OrganizationUpdateRequest,
    organization: Organization = Depends(get_current_organization),
    _actor: OrganizationUser = Depends(require_role(*ROLES_MANAGE_ORGANIZATION)),
    db: AsyncSession = Depends(get_db),
) -> OrganizationOut:
    updated = await organization_service.update_name(db, organization, payload.name)
    return OrganizationOut.model_validate(updated)


def _member_out(member: OrganizationUser) -> MemberOut:
    return MemberOut(
        user_id=member.user_id,
        name=member.user.name,
        email=member.user.email,
        role=member.role,
        status=member.user.status,
        member_since=member.created_at,
    )


@router.get("/members", response_model=list[MemberOut])
async def list_members(
    search: str | None = Query(default=None),
    role: OrganizationRole | None = Query(default=None),
    membership: OrganizationUser = Depends(get_current_membership),
    db: AsyncSession = Depends(get_db),
) -> list[MemberOut]:
    members = await organization_repository.list_members(
        db, membership.organization_id, search=search, role=role
    )
    return [_member_out(m) for m in members]


@router.patch("/members/{user_id}", response_model=MemberOut)
async def update_member_role(
    user_id: uuid.UUID,
    payload: MemberRoleUpdateRequest,
    membership: OrganizationUser = Depends(require_role(*ROLES_MANAGE_USERS)),
    db: AsyncSession = Depends(get_db),
) -> MemberOut:
    updated = await organization_service.change_member_role(
        db,
        organization_id=membership.organization_id,
        actor_membership=membership,
        target_user_id=user_id,
        new_role=payload.role,
    )
    return _member_out(updated)


@router.delete("/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    user_id: uuid.UUID,
    membership: OrganizationUser = Depends(require_role(*ROLES_MANAGE_USERS)),
    db: AsyncSession = Depends(get_db),
) -> None:
    await organization_service.remove_member(
        db,
        organization_id=membership.organization_id,
        actor_membership=membership,
        target_user_id=user_id,
    )


def _invite_out(invite: OrganizationInvite, raw_token: str | None) -> InviteOut:
    invite_url = None
    # Sem provedor de email neste MVP: em dev, o link fica visível na
    # resposta da API e no log. Fora de dev, nada é exposto por aqui.
    if raw_token and settings.app_env == "development":
        invite_url = f"{settings.public_app_url}/accept-invite?token={raw_token}"
    return InviteOut(
        id=invite.id,
        email=invite.email,
        role=invite.role,
        expires_at=invite.expires_at,
        created_at=invite.created_at,
        accepted_at=invite.accepted_at,
        invite_url=invite_url,
    )


@router.get("/invites", response_model=list[InviteOut])
async def list_invites(
    membership: OrganizationUser = Depends(require_role(*ROLES_MANAGE_USERS)),
    db: AsyncSession = Depends(get_db),
) -> list[InviteOut]:
    invites = await invite_service.list_invites(db, membership.organization_id)
    return [_invite_out(i, None) for i in invites]


@router.post("/invites", response_model=InviteOut, status_code=status.HTTP_201_CREATED)
async def create_invite(
    payload: InviteCreateRequest,
    membership: OrganizationUser = Depends(require_role(*ROLES_MANAGE_USERS)),
    db: AsyncSession = Depends(get_db),
) -> InviteOut:
    if not can_manage_target_role(membership.role, payload.role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Você não pode convidar alguém para esta role")

    result = await invite_service.create_invite(
        db,
        organization_id=membership.organization_id,
        email=payload.email,
        role=payload.role,
        created_by=membership.user_id,
    )
    if settings.app_env == "development":
        logger.info(
            "convite (dev) org=%s email=%s role=%s link=%s/accept-invite?token=%s",
            membership.organization_id,
            payload.email,
            payload.role.value,
            settings.public_app_url,
            result.raw_token,
        )
    return _invite_out(result.invite, result.raw_token)


@router.delete("/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invite(
    invite_id: uuid.UUID,
    membership: OrganizationUser = Depends(require_role(*ROLES_MANAGE_USERS)),
    db: AsyncSession = Depends(get_db),
) -> None:
    await invite_service.revoke_invite(db, organization_id=membership.organization_id, invite_id=invite_id)
