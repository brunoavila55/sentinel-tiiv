"""Regras de RBAC (PROMPT 04). Testadas no nível dos helpers de
`app.core.authorization`, que são o único lugar de onde qualquer router
(atual ou futuro) deve derivar decisões de permissão.

Cenários pedidos explicitamente no CLAUDE.md:
- viewer não altera ativo (nenhuma escrita operacional);
- operator não gerencia usuário;
- admin não remove/rebaixa owner;
- owner possui acesso integral.

Ainda não existem rotas de negócio (assets/sites chegam em prompts
futuros) para testar isso via HTTP; quando existirem, devem reusar
exatamente `require_role`/`can_manage_target_role` — o que estes testes
fixam como contrato.
"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core.authorization import (
    ROLES_MANAGE_ORGANIZATION,
    ROLES_MANAGE_USERS,
    ROLES_READ_ONLY,
    ROLES_WRITE_OPERATIONAL,
    can_manage_target_role,
    ensure_role,
)
from app.models.enums import OrganizationRole

OWNER = OrganizationRole.OWNER
ADMIN = OrganizationRole.ADMIN
OPERATOR = OrganizationRole.OPERATOR
VIEWER = OrganizationRole.VIEWER


def _membership(role: OrganizationRole) -> SimpleNamespace:
    return SimpleNamespace(role=role)


@pytest.mark.parametrize("role", [OWNER, ADMIN, OPERATOR, VIEWER])
def test_owner_has_full_access_every_role_group_includes_owner(role: OrganizationRole) -> None:
    for group in (ROLES_MANAGE_ORGANIZATION, ROLES_MANAGE_USERS, ROLES_WRITE_OPERATIONAL, ROLES_READ_ONLY):
        if role == OWNER:
            assert OWNER in group


def test_viewer_cannot_write_operational_data() -> None:
    assert VIEWER not in ROLES_WRITE_OPERATIONAL
    with pytest.raises(HTTPException) as exc_info:
        ensure_role(_membership(VIEWER), *ROLES_WRITE_OPERATIONAL)
    assert exc_info.value.status_code == 403


def test_viewer_is_read_only() -> None:
    assert VIEWER in ROLES_READ_ONLY
    ensure_role(_membership(VIEWER), *ROLES_READ_ONLY)  # não deve levantar


def test_operator_cannot_manage_users() -> None:
    assert OPERATOR not in ROLES_MANAGE_USERS
    with pytest.raises(HTTPException) as exc_info:
        ensure_role(_membership(OPERATOR), *ROLES_MANAGE_USERS)
    assert exc_info.value.status_code == 403


def test_operator_can_write_operational_data() -> None:
    ensure_role(_membership(OPERATOR), *ROLES_WRITE_OPERATIONAL)  # não deve levantar


def test_only_owner_manages_organization() -> None:
    assert tuple(ROLES_MANAGE_ORGANIZATION) == (OWNER,)


@pytest.mark.parametrize(
    ("actor", "target", "expected"),
    [
        (OWNER, OWNER, True),
        (OWNER, ADMIN, True),
        (OWNER, VIEWER, True),
        (ADMIN, OWNER, False),  # admin não remove/rebaixa owner
        (ADMIN, ADMIN, True),
        (ADMIN, OPERATOR, True),
        (ADMIN, VIEWER, True),
        (OPERATOR, VIEWER, False),  # operator não gerencia usuário nenhum
        (VIEWER, VIEWER, False),
    ],
)
def test_can_manage_target_role(actor: OrganizationRole, target: OrganizationRole, expected: bool) -> None:
    assert can_manage_target_role(actor, target) is expected
