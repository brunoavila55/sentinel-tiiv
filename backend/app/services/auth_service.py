from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import (
    DUMMY_PASSWORD_HASH,
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.core.slug import slugify
from app.models.enums import OrganizationRole, UserStatus
from app.models.organization import Organization
from app.models.organization_user import OrganizationUser
from app.models.user import User
from app.repositories import organization_repository, refresh_token_repository, user_repository

settings = get_settings()


@dataclass
class AuthResult:
    user: User
    access_token: str
    access_token_expires_at: datetime
    refresh_token: str
    refresh_token_expires_at: datetime


async def issue_tokens(
    db: AsyncSession, user: User, *, user_agent: str | None, ip_address: str | None
) -> AuthResult:
    access_token, access_expires_at = create_access_token(user.id)

    refresh_token = generate_refresh_token()
    refresh_expires_at = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    await refresh_token_repository.create(
        db,
        user_id=user.id,
        token_hash=hash_token(refresh_token),
        expires_at=refresh_expires_at,
        user_agent=user_agent,
        ip_address=ip_address,
    )
    return AuthResult(user, access_token, access_expires_at, refresh_token, refresh_expires_at)


async def register(
    db: AsyncSession,
    *,
    name: str,
    email: str,
    password: str,
    organization_name: str,
    user_agent: str | None,
    ip_address: str | None,
) -> AuthResult:
    existing = await user_repository.get_by_email(db, email)
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Este email já está cadastrado")

    base_slug = slugify(organization_name)
    slug = base_slug
    suffix = 1
    while await organization_repository.slug_exists(db, slug):
        suffix += 1
        slug = f"{base_slug}-{suffix}"

    user = User(name=name, email=email, password_hash=hash_password(password))
    organization = Organization(name=organization_name, slug=slug)
    db.add_all([user, organization])
    await db.flush()

    db.add(OrganizationUser(organization_id=organization.id, user_id=user.id, role=OrganizationRole.OWNER))
    await db.flush()

    result = await issue_tokens(db, user, user_agent=user_agent, ip_address=ip_address)
    await db.commit()
    return result


async def login(
    db: AsyncSession, *, email: str, password: str, user_agent: str | None, ip_address: str | None
) -> AuthResult:
    user = await user_repository.get_by_email(db, email)
    # Mesma mensagem para email inexistente e senha errada: não revelar se
    # o email está cadastrado. E sempre chamar verify_password (mesmo sem
    # usuário, contra um hash de descarte) pra não vazar a mesma informação
    # por temporização — ver DUMMY_PASSWORD_HASH.
    invalid_credentials = HTTPException(status.HTTP_401_UNAUTHORIZED, "Email ou senha inválidos")
    password_hash = user.password_hash if user is not None else DUMMY_PASSWORD_HASH
    password_valid = verify_password(password, password_hash)
    if user is None or not password_valid:
        raise invalid_credentials
    if user.status != UserStatus.ACTIVE:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Usuário desabilitado")

    result = await issue_tokens(db, user, user_agent=user_agent, ip_address=ip_address)
    await db.commit()
    return result


async def refresh(
    db: AsyncSession, *, refresh_token_value: str | None, user_agent: str | None, ip_address: str | None
) -> AuthResult:
    invalid = HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão inválida ou expirada")
    if not refresh_token_value:
        raise invalid

    token = await refresh_token_repository.get_valid_by_hash(db, hash_token(refresh_token_value))
    if token is None:
        raise invalid

    user = await user_repository.get_by_id(db, token.user_id)
    if user is None or user.status != UserStatus.ACTIVE:
        raise invalid

    # Rotação: o refresh token usado é revogado e um novo é emitido a cada
    # chamada. Reduz o impacto de um token vazado (uso só é válido uma vez).
    await refresh_token_repository.revoke(db, token)
    result = await issue_tokens(db, user, user_agent=user_agent, ip_address=ip_address)
    await db.commit()
    return result


async def logout(db: AsyncSession, *, refresh_token_value: str | None) -> None:
    if not refresh_token_value:
        return
    token = await refresh_token_repository.get_valid_by_hash(db, hash_token(refresh_token_value))
    if token is not None:
        await refresh_token_repository.revoke(db, token)
        await db.commit()


async def change_password(db: AsyncSession, *, user: User, current_password: str, new_password: str) -> None:
    if not verify_password(current_password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Senha atual incorreta")
    user.password_hash = hash_password(new_password)
    # Troca de senha derruba todas as sessões existentes, inclusive as que
    # possam ter sido comprometidas.
    await refresh_token_repository.revoke_all_for_user(db, user.id)
    await db.commit()
