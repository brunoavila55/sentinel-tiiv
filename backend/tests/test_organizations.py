from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models.enums import OrganizationRole
from tests.factories import create_org_member


async def _auth_headers(db_session: AsyncSession, *, email: str, role: OrganizationRole, org_name: str = "Org"):
    member = await create_org_member(db_session, org_name=org_name, email=email, role=role)
    token, _ = create_access_token(member.user.id)
    return (
        {"Authorization": f"Bearer {token}", "X-Organization-Id": str(member.organization.id)},
        member,
    )


async def test_get_current_organization(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, member = await _auth_headers(db_session, email="owner@example.com", role=OrganizationRole.OWNER)
    response = await client.get("/api/organizations/current", headers=headers)
    assert response.status_code == 200
    assert response.json()["id"] == str(member.organization.id)


async def test_only_owner_can_rename_organization(client: AsyncClient, db_session: AsyncSession) -> None:
    admin_headers, _ = await _auth_headers(db_session, email="admin@example.com", role=OrganizationRole.ADMIN)
    response = await client.patch(
        "/api/organizations/current", headers=admin_headers, json={"name": "Novo nome"}
    )
    assert response.status_code == 403

    owner_headers, _ = await _auth_headers(
        db_session, email="owner2@example.com", role=OrganizationRole.OWNER, org_name="Outra Org"
    )
    response = await client.patch(
        "/api/organizations/current", headers=owner_headers, json={"name": "Novo nome"}
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Novo nome"


async def test_list_members_search_and_filter(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, member = await _auth_headers(db_session, email="owner@example.com", role=OrganizationRole.OWNER)

    from app.models.organization_user import OrganizationUser
    from tests.factories import create_org_member as _create

    viewer = await _create(db_session, org_name="ignorado", email="viewer@example.com", role=OrganizationRole.VIEWER)
    db_session.add(
        OrganizationUser(organization_id=member.organization.id, user_id=viewer.user.id, role=OrganizationRole.VIEWER)
    )
    await db_session.commit()

    response = await client.get("/api/organizations/members", headers=headers)
    assert response.status_code == 200
    assert len(response.json()) == 2

    response = await client.get("/api/organizations/members?role=viewer", headers=headers)
    assert [m["email"] for m in response.json()] == ["viewer@example.com"]

    response = await client.get("/api/organizations/members?search=owner", headers=headers)
    assert [m["email"] for m in response.json()] == ["owner@example.com"]


async def test_admin_cannot_remove_owner(client: AsyncClient, db_session: AsyncSession) -> None:
    owner_headers, owner_member = await _auth_headers(
        db_session, email="owner@example.com", role=OrganizationRole.OWNER
    )
    admin = await create_org_member(
        db_session, org_name="ignorado2", email="admin@example.com", role=OrganizationRole.ADMIN
    )
    from app.models.organization_user import OrganizationUser

    db_session.add(
        OrganizationUser(
            organization_id=owner_member.organization.id, user_id=admin.user.id, role=OrganizationRole.ADMIN
        )
    )
    await db_session.commit()

    token, _ = create_access_token(admin.user.id)
    admin_headers = {"Authorization": f"Bearer {token}", "X-Organization-Id": str(owner_member.organization.id)}

    response = await client.delete(f"/api/organizations/members/{owner_member.user.id}", headers=admin_headers)
    assert response.status_code == 403

    response = await client.patch(
        f"/api/organizations/members/{owner_member.user.id}",
        headers=admin_headers,
        json={"role": "viewer"},
    )
    assert response.status_code == 403


async def test_cannot_remove_last_owner(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, member = await _auth_headers(db_session, email="owner@example.com", role=OrganizationRole.OWNER)
    response = await client.delete(f"/api/organizations/members/{member.user.id}", headers=headers)
    assert response.status_code == 409


async def test_viewer_cannot_manage_members(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, _ = await _auth_headers(db_session, email="viewer@example.com", role=OrganizationRole.VIEWER)
    response = await client.get("/api/organizations/members", headers=headers)
    assert response.status_code == 200  # leitura é permitida a qualquer role

    import uuid

    response = await client.delete(f"/api/organizations/members/{uuid.uuid4()}", headers=headers)
    assert response.status_code == 403
