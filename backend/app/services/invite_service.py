import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import generate_secure_token, hash_password, hash_token, verify_password
from app.models.enums import OrganizationRole, UserStatus
from app.models.organization_invite import OrganizationInvite
from app.models.organization_user import OrganizationUser
from app.models.user import User
from app.repositories import invite_repository, organization_repository, user_repository
from app.services import audit_service, entitlement_service
from app.services.auth_service import AuthResult, issue_tokens

settings = get_settings()


@dataclass
class InviteCreationResult:
    invite: OrganizationInvite
    raw_token: str


@dataclass
class InvitePreview:
    organization_name: str
    email: str
    role: OrganizationRole
    expires_at: datetime
    account_exists: bool


async def create_invite(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    email: str,
    role: OrganizationRole,
    created_by: uuid.UUID,
) -> InviteCreationResult:
    existing_user = await user_repository.get_by_email(db, email)
    if existing_user is not None:
        membership = await organization_repository.get_member_by_user_id(db, organization_id, existing_user.id)
        if membership is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Este usuário já é membro da organização")

    # Falha cedo: sem vaga no plano, nem cria o convite (evita um admin
    # convidar 10 pessoas quando só há 2 vagas — accept_invite valida de
    # novo na aceitação, que é o momento em que a vaga é ocupada de fato).
    await entitlement_service.ensure_can_add_user(db, organization_id)

    # Convite pendente anterior para o mesmo email é substituído, não
    # duplicado — evita múltiplos convites simultâneos com tokens distintos.
    pending = await invite_repository.get_pending_by_email(db, organization_id, email)
    if pending is not None:
        await invite_repository.delete(db, pending)
        await db.flush()

    raw_token = generate_secure_token()
    invite = await invite_repository.create(
        db,
        organization_id=organization_id,
        email=email,
        role=role,
        token_hash=hash_token(raw_token),
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.invite_expire_days),
        created_by=created_by,
    )
    await db.flush()
    await audit_service.record(
        db,
        organization_id=organization_id,
        user_id=created_by,
        action="user.invited",
        entity_type="organization_invite",
        entity_id=invite.id,
        metadata={"email": email, "role": role.value},
    )
    await db.commit()
    await db.refresh(invite)
    return InviteCreationResult(invite=invite, raw_token=raw_token)


async def list_invites(db: AsyncSession, organization_id: uuid.UUID) -> list[OrganizationInvite]:
    return await invite_repository.list_pending(db, organization_id)


async def revoke_invite(db: AsyncSession, *, organization_id: uuid.UUID, invite_id: uuid.UUID) -> None:
    invite = await invite_repository.get_by_id(db, organization_id, invite_id)
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Convite não encontrado")
    await invite_repository.delete(db, invite)
    await db.commit()


async def preview_invite(db: AsyncSession, *, token: str) -> InvitePreview:
    invite = await invite_repository.get_valid_by_token_hash(db, hash_token(token))
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Convite inválido ou expirado")

    organization = await organization_repository.get_by_id(db, invite.organization_id)
    existing_user = await user_repository.get_by_email(db, invite.email)
    return InvitePreview(
        organization_name=organization.name,
        email=invite.email,
        role=invite.role,
        expires_at=invite.expires_at,
        account_exists=existing_user is not None,
    )


async def accept_invite(
    db: AsyncSession,
    *,
    token: str,
    name: str | None,
    password: str,
    user_agent: str | None,
    ip_address: str | None,
) -> AuthResult:
    invite = await invite_repository.get_valid_by_token_hash(db, hash_token(token))
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Convite inválido ou expirado")

    user = await user_repository.get_by_email(db, invite.email)
    if user is None:
        if not name:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Nome é obrigatório para criar a conta")
        user = User(name=name, email=invite.email, password_hash=hash_password(password))
        db.add(user)
        await db.flush()
    else:
        # A senha também serve para confirmar posse da conta existente —
        # evita que outra pessoa com acesso ao link assuma a conta do email.
        if not verify_password(password, user.password_hash):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Senha incorreta para a conta existente")
        if user.status != UserStatus.ACTIVE:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Usuário desabilitado")

    existing_membership = await organization_repository.get_member_by_user_id(
        db, invite.organization_id, user.id
    )
    if existing_membership is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Você já é membro desta organização")

    await entitlement_service.ensure_can_add_user(db, invite.organization_id)

    db.add(OrganizationUser(organization_id=invite.organization_id, user_id=user.id, role=invite.role))
    invite.accepted_at = datetime.now(timezone.utc)
    await db.flush()

    result = await issue_tokens(db, user, user_agent=user_agent, ip_address=ip_address)
    await db.commit()
    return result
