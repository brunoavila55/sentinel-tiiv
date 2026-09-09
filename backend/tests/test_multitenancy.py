"""Isolamento multi-tenant: usuário da organização A não acessa organização B.

Usa um app FastAPI-sonda, mínimo, que depende das mesmas dependencies de
produção (`get_current_organization`/`get_current_membership` em
app.core.dependencies) — exercita o código real sem precisar de uma rota de
negócio já implementada (assets/sites chegam em prompts futuros).
"""

from collections.abc import AsyncIterator

import pytest_asyncio
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_organization
from app.models.enums import OrganizationRole
from app.models.organization import Organization
from tests.factories import create_org_member


def _build_probe_app() -> FastAPI:
    probe = FastAPI()

    @probe.get("/probe/organization")
    async def _probe(organization: Organization = Depends(get_current_organization)) -> dict:
        return {"organization_id": str(organization.id), "organization_name": organization.name}

    return probe


@pytest_asyncio.fixture
async def probe_client(db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    probe = _build_probe_app()

    async def _override_get_db() -> AsyncIterator[AsyncSession]:
        yield db_session

    probe.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=probe)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def _access_token_for(db_session: AsyncSession, email: str) -> tuple[str, str]:
    from app.core.security import create_access_token

    member = await create_org_member(db_session, org_name=f"Org {email}", email=email)
    token, _ = create_access_token(member.user.id)
    return token, str(member.organization.id)


async def test_user_cannot_access_organization_they_are_not_a_member_of(
    db_session: AsyncSession, probe_client: AsyncClient
) -> None:
    token_a, org_a_id = await _access_token_for(db_session, "user-a@example.com")
    _token_b, org_b_id = await _access_token_for(db_session, "user-b@example.com")

    # usuário A com o organization_id de B: deve ser recusado.
    response = await probe_client.get(
        "/probe/organization",
        headers={"Authorization": f"Bearer {token_a}", "X-Organization-Id": org_b_id},
    )
    assert response.status_code == 404

    # usuário A com sua própria organização: deve funcionar.
    response = await probe_client.get(
        "/probe/organization",
        headers={"Authorization": f"Bearer {token_a}", "X-Organization-Id": org_a_id},
    )
    assert response.status_code == 200
    assert response.json()["organization_id"] == org_a_id


async def test_missing_organization_header_is_rejected(
    db_session: AsyncSession, probe_client: AsyncClient
) -> None:
    token_a, _org_a_id = await _access_token_for(db_session, "solo@example.com")

    response = await probe_client.get("/probe/organization", headers={"Authorization": f"Bearer {token_a}"})
    assert response.status_code == 400


async def test_user_can_belong_to_multiple_organizations(db_session: AsyncSession, probe_client: AsyncClient) -> None:
    from app.core.security import create_access_token
    from app.models.organization_user import OrganizationUser

    member = await create_org_member(db_session, org_name="Primeira Org", email="multi@example.com")
    second_org_member = await create_org_member(db_session, org_name="Segunda Org", email="dono2@example.com")
    db_session.add(
        OrganizationUser(
            organization_id=second_org_member.organization.id,
            user_id=member.user.id,
            role=OrganizationRole.VIEWER,
        )
    )
    await db_session.commit()

    token, _ = create_access_token(member.user.id)

    for org_id in (str(member.organization.id), str(second_org_member.organization.id)):
        response = await probe_client.get(
            "/probe/organization",
            headers={"Authorization": f"Bearer {token}", "X-Organization-Id": org_id},
        )
        assert response.status_code == 200
