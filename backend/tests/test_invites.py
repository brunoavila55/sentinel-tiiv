from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models.enums import OrganizationRole
from tests.factories import create_org_member


async def _owner_headers(db_session: AsyncSession, org_name: str = "Empresa"):
    member = await create_org_member(db_session, org_name=org_name, email="owner@example.com", role=OrganizationRole.OWNER)
    token, _ = create_access_token(member.user.id)
    return {"Authorization": f"Bearer {token}", "X-Organization-Id": str(member.organization.id)}, member


async def test_create_invite_returns_dev_link(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, _ = await _owner_headers(db_session)
    response = await client.post(
        "/api/organizations/invites",
        headers=headers,
        json={"email": "novo@example.com", "role": "operator"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "novo@example.com"
    assert body["invite_url"] is not None
    assert "token=" in body["invite_url"]


async def test_admin_cannot_invite_owner(client: AsyncClient, db_session: AsyncSession) -> None:
    owner_headers, owner_member = await _owner_headers(db_session)
    from app.models.organization_user import OrganizationUser

    admin = await create_org_member(db_session, org_name="ignorado", email="admin@example.com", role=OrganizationRole.ADMIN)
    db_session.add(
        OrganizationUser(organization_id=owner_member.organization.id, user_id=admin.user.id, role=OrganizationRole.ADMIN)
    )
    await db_session.commit()

    token, _ = create_access_token(admin.user.id)
    admin_headers = {"Authorization": f"Bearer {token}", "X-Organization-Id": str(owner_member.organization.id)}

    response = await client.post(
        "/api/organizations/invites", headers=admin_headers, json={"email": "x@example.com", "role": "owner"}
    )
    assert response.status_code == 403


async def test_second_invite_replaces_pending_one(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, _ = await _owner_headers(db_session)
    first = await client.post(
        "/api/organizations/invites", headers=headers, json={"email": "dup@example.com", "role": "viewer"}
    )
    second = await client.post(
        "/api/organizations/invites", headers=headers, json={"email": "dup@example.com", "role": "operator"}
    )
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] != second.json()["id"]

    listed = await client.get("/api/organizations/invites", headers=headers)
    assert len(listed.json()) == 1
    assert listed.json()[0]["role"] == "operator"


async def test_accept_invite_creates_account_and_membership(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, member = await _owner_headers(db_session)
    create_response = await client.post(
        "/api/organizations/invites", headers=headers, json={"email": "novo@example.com", "role": "operator"}
    )
    token = create_response.json()["invite_url"].split("token=")[1]

    preview = await client.get(f"/api/invites/{token}")
    assert preview.status_code == 200
    assert preview.json()["account_exists"] is False

    accept = await client.post(
        "/api/invites/accept", json={"token": token, "name": "Novo", "password": "senha12345"}
    )
    assert accept.status_code == 200

    members = await client.get("/api/organizations/members", headers=headers)
    emails = [m["email"] for m in members.json()]
    assert "novo@example.com" in emails

    # token já usado não pode ser aceito de novo
    reuse = await client.post(
        "/api/invites/accept", json={"token": token, "name": "Novo", "password": "senha12345"}
    )
    assert reuse.status_code == 404


async def test_accept_invite_for_existing_user_requires_correct_password(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers, _ = await _owner_headers(db_session)
    # usuário existente em outra organização
    await create_org_member(db_session, org_name="Outra", email="ja-existe@example.com", role=OrganizationRole.OWNER)

    create_response = await client.post(
        "/api/organizations/invites", headers=headers, json={"email": "ja-existe@example.com", "role": "viewer"}
    )
    token = create_response.json()["invite_url"].split("token=")[1]

    wrong_password = await client.post(
        "/api/invites/accept", json={"token": token, "password": "senhaerrada123"}
    )
    assert wrong_password.status_code == 401

    right_password = await client.post(
        "/api/invites/accept", json={"token": token, "password": "senha12345"}
    )
    assert right_password.status_code == 200
