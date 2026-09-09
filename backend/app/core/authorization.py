"""Helpers de autorização por role, reutilizáveis entre routers.

Objetivo: nenhum router deve conter `if membership.role == "admin": ...`
espalhado. Toda decisão de "quem pode fazer o quê" fica centralizada aqui.
"""

from collections.abc import Callable, Sequence
from typing import Annotated

from fastapi import Depends, HTTPException, status

from app.core.dependencies import get_current_membership
from app.models.enums import OrganizationRole
from app.models.organization_user import OrganizationUser

# Grupos de roles por natureza da ação (ver PROMPT 04 do CLAUDE.md).
ROLES_MANAGE_ORGANIZATION: Sequence[OrganizationRole] = (OrganizationRole.OWNER,)
ROLES_MANAGE_USERS: Sequence[OrganizationRole] = (OrganizationRole.OWNER, OrganizationRole.ADMIN)
# Sites: só owner/admin (ver PROMPT 04 — operator não está listado entre
# quem gerencia sites, só ativos/checks/topologia).
ROLES_MANAGE_SITES: Sequence[OrganizationRole] = (OrganizationRole.OWNER, OrganizationRole.ADMIN)
ROLES_WRITE_OPERATIONAL: Sequence[OrganizationRole] = (
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.OPERATOR,
)
ROLES_READ_ONLY: Sequence[OrganizationRole] = tuple(OrganizationRole)  # todas, viewer incluído


def ensure_role(membership: OrganizationUser, *allowed_roles: OrganizationRole) -> None:
    if membership.role not in allowed_roles:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Você não tem permissão para executar esta ação")


def require_role(*allowed_roles: OrganizationRole) -> Callable[..., OrganizationUser]:
    """Dependency factory: `Depends(require_role(*ROLES_WRITE_OPERATIONAL))`."""

    async def _dependency(
        membership: Annotated[OrganizationUser, Depends(get_current_membership)],
    ) -> OrganizationUser:
        ensure_role(membership, *allowed_roles)
        return membership

    return _dependency


def can_manage_target_role(actor_role: OrganizationRole, target_role: OrganizationRole) -> bool:
    """Regra fina que um conjunto estático de roles não expressa: admin
    pode gerenciar usuários, mas nunca remover ou rebaixar um owner."""
    if actor_role == OrganizationRole.OWNER:
        return True
    if actor_role == OrganizationRole.ADMIN:
        return target_role != OrganizationRole.OWNER
    return False
