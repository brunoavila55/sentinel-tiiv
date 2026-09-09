from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.organization_user import OrganizationUser
from app.models.user import User


async def _register(client: AsyncClient, email: str = "joao@example.com") -> dict:
    response = await client.post(
        "/api/auth/register",
        json={
            "name": "Joao",
            "email": email,
            "password": "senha12345",
            "organization_name": "Empresa A",
        },
    )
    assert response.status_code == 201
    return response.json()


async def test_register_creates_user_organization_and_owner_membership(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    body = await _register(client)

    user = (await db_session.execute(select(User).where(User.email == "joao@example.com"))).scalar_one()
    membership = (
        await db_session.execute(select(OrganizationUser).where(OrganizationUser.user_id == user.id))
    ).scalar_one()

    assert membership.role.value == "owner"
    assert body["user"]["email"] == "joao@example.com"
    assert "sentinel_refresh_token" in client.cookies


async def test_register_rejects_duplicate_email(client: AsyncClient) -> None:
    await _register(client)
    response = await client.post(
        "/api/auth/register",
        json={
            "name": "Outro",
            "email": "joao@example.com",
            "password": "outrasenha1",
            "organization_name": "Outra Empresa",
        },
    )
    assert response.status_code == 409


async def test_login_with_wrong_password_returns_401(client: AsyncClient) -> None:
    await _register(client)
    response = await client.post(
        "/api/auth/login", json={"email": "joao@example.com", "password": "senhaerrada"}
    )
    assert response.status_code == 401


async def test_me_requires_authentication(client: AsyncClient) -> None:
    response = await client.get("/api/auth/me")
    assert response.status_code == 401


async def test_me_lists_memberships(client: AsyncClient) -> None:
    body = await _register(client)
    access_token = body["access_token"]

    response = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {access_token}"})
    assert response.status_code == 200
    memberships = response.json()["memberships"]
    assert len(memberships) == 1
    assert memberships[0]["role"] == "owner"
    assert memberships[0]["organization_name"] == "Empresa A"


async def test_refresh_rotates_token_and_invalidates_previous(client: AsyncClient) -> None:
    await _register(client)
    old_refresh_cookie = client.cookies.get("sentinel_refresh_token")

    response = await client.post("/api/auth/refresh")
    assert response.status_code == 200
    new_refresh_cookie = client.cookies.get("sentinel_refresh_token")
    assert new_refresh_cookie != old_refresh_cookie

    # reaplica o cookie antigo manualmente: deve ter sido revogado pela rotação
    client.cookies.set("sentinel_refresh_token", old_refresh_cookie)
    reused = await client.post("/api/auth/refresh")
    assert reused.status_code == 401


async def test_logout_revokes_refresh_token(client: AsyncClient) -> None:
    await _register(client)
    logout_response = await client.post("/api/auth/logout")
    assert logout_response.status_code == 204

    refresh_response = await client.post("/api/auth/refresh")
    assert refresh_response.status_code == 401


async def test_change_password_revokes_existing_sessions(client: AsyncClient) -> None:
    body = await _register(client)
    access_token = body["access_token"]

    change_response = await client.post(
        "/api/auth/change-password",
        headers={"Authorization": f"Bearer {access_token}"},
        json={"current_password": "senha12345", "new_password": "novasenha123"},
    )
    assert change_response.status_code == 204

    refresh_response = await client.post("/api/auth/refresh")
    assert refresh_response.status_code == 401

    login_old = await client.post(
        "/api/auth/login", json={"email": "joao@example.com", "password": "senha12345"}
    )
    assert login_old.status_code == 401

    login_new = await client.post(
        "/api/auth/login", json={"email": "joao@example.com", "password": "novasenha123"}
    )
    assert login_new.status_code == 200
