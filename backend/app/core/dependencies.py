import uuid

import jwt
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.enums import UserStatus
from app.models.organization import Organization
from app.models.organization_user import OrganizationUser
from app.models.user import User
from app.repositories import organization_repository, user_repository

_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Não autenticado")
    try:
        user_id = decode_access_token(credentials.credentials)
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido ou expirado") from exc

    user = await user_repository.get_by_id(db, user_id)
    if user is None or user.status != UserStatus.ACTIVE:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuário inválido")
    return user


async def get_current_membership(
    x_organization_id: uuid.UUID | None = Header(default=None, alias="X-Organization-Id"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OrganizationUser:
    """Nunca confia no organization_id enviado pelo cliente: valida contra
    o banco que o usuário autenticado realmente pertence à organização."""
    if x_organization_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cabeçalho X-Organization-Id é obrigatório")

    membership = await organization_repository.get_membership(db, x_organization_id, current_user.id)
    if membership is None:
        # 404 em vez de 403: não confirma para quem não é membro se a
        # organização sequer existe.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organização não encontrada")
    return membership


async def get_current_organization(
    membership: OrganizationUser = Depends(get_current_membership),
) -> Organization:
    return membership.organization
