import io

from httpx import AsyncClient
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models.enums import OrganizationRole
from tests.factories import create_org_member


def _image_bytes(fmt: str = "PNG", size: tuple[int, int] = (8, 8)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, color=(10, 20, 30)).save(buffer, format=fmt)
    return buffer.getvalue()


async def _auth_headers(db_session: AsyncSession, *, email: str, role: OrganizationRole, org_name: str = "Org"):
    member = await create_org_member(db_session, org_name=org_name, email=email, role=role)
    token, _ = create_access_token(member.user.id)
    return (
        {"Authorization": f"Bearer {token}", "X-Organization-Id": str(member.organization.id)},
        member,
    )


async def test_owner_uploads_and_removes_logo_light(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, _ = await _auth_headers(db_session, email="owner@example.com", role=OrganizationRole.OWNER)

    files = {"file": ("logo.png", _image_bytes(), "image/png")}
    response = await client.post("/api/organizations/current/logo-light", headers=headers, files=files)
    assert response.status_code == 200
    body = response.json()
    assert body["logo_light_url"] is not None
    assert body["logo_dark_url"] is None

    response = await client.get("/api/organizations/current", headers=headers)
    assert response.json()["logo_light_url"] is not None

    response = await client.delete("/api/organizations/current/logo-light", headers=headers)
    assert response.status_code == 200
    assert response.json()["logo_light_url"] is None


async def test_owner_uploads_and_removes_logo_dark(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, _ = await _auth_headers(db_session, email="owner@example.com", role=OrganizationRole.OWNER)

    files = {"file": ("logo-dark.png", _image_bytes(), "image/png")}
    response = await client.post("/api/organizations/current/logo-dark", headers=headers, files=files)
    assert response.status_code == 200
    body = response.json()
    assert body["logo_dark_url"] is not None
    assert body["logo_light_url"] is None

    response = await client.delete("/api/organizations/current/logo-dark", headers=headers)
    assert response.status_code == 200
    assert response.json()["logo_dark_url"] is None


async def test_light_and_dark_logo_are_independent(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, _ = await _auth_headers(db_session, email="owner@example.com", role=OrganizationRole.OWNER)

    files = {"file": ("light.png", _image_bytes(), "image/png")}
    await client.post("/api/organizations/current/logo-light", headers=headers, files=files)
    files = {"file": ("dark.png", _image_bytes(), "image/png")}
    await client.post("/api/organizations/current/logo-dark", headers=headers, files=files)

    response = await client.get("/api/organizations/current", headers=headers)
    body = response.json()
    assert body["logo_light_url"] is not None
    assert body["logo_dark_url"] is not None
    assert body["logo_light_url"] != body["logo_dark_url"]

    response = await client.delete("/api/organizations/current/logo-light", headers=headers)
    body = response.json()
    assert body["logo_light_url"] is None
    assert body["logo_dark_url"] is not None


async def test_owner_uploads_favicon(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, _ = await _auth_headers(db_session, email="owner@example.com", role=OrganizationRole.OWNER)

    files = {"file": ("icon.png", _image_bytes(), "image/png")}
    response = await client.post("/api/organizations/current/favicon", headers=headers, files=files)
    assert response.status_code == 200
    assert response.json()["favicon_url"] is not None


async def test_replacing_logo_keeps_only_the_new_key(client: AsyncClient, db_session: AsyncSession) -> None:
    from app.repositories import organization_repository

    headers, member = await _auth_headers(db_session, email="owner@example.com", role=OrganizationRole.OWNER)

    files = {"file": ("logo.png", _image_bytes(), "image/png")}
    await client.post("/api/organizations/current/logo-light", headers=headers, files=files)
    org = await organization_repository.get_by_id(db_session, member.organization.id)
    first_key = org.logo_light_storage_key

    files = {"file": ("logo2.png", _image_bytes(size=(4, 4)), "image/png")}
    await client.post("/api/organizations/current/logo-light", headers=headers, files=files)
    await db_session.refresh(org)
    assert org.logo_light_storage_key != first_key


async def test_non_owner_cannot_manage_branding(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, _ = await _auth_headers(db_session, email="admin@example.com", role=OrganizationRole.ADMIN)

    files = {"file": ("logo.png", _image_bytes(), "image/png")}
    response = await client.post("/api/organizations/current/logo-light", headers=headers, files=files)
    assert response.status_code == 403

    response = await client.post("/api/organizations/current/logo-dark", headers=headers, files=files)
    assert response.status_code == 403


async def test_rejects_invalid_logo_content(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, _ = await _auth_headers(db_session, email="owner@example.com", role=OrganizationRole.OWNER)

    files = {"file": ("logo.png", b"not-an-image", "image/png")}
    response = await client.post("/api/organizations/current/logo-light", headers=headers, files=files)
    assert response.status_code == 422


async def test_organization_a_cannot_see_organization_b_logo(client: AsyncClient, db_session: AsyncSession) -> None:
    headers_a, _ = await _auth_headers(
        db_session, email="owner-a@example.com", role=OrganizationRole.OWNER, org_name="Org A"
    )
    headers_b, _ = await _auth_headers(
        db_session, email="owner-b@example.com", role=OrganizationRole.OWNER, org_name="Org B"
    )

    files = {"file": ("logo.png", _image_bytes(), "image/png")}
    await client.post("/api/organizations/current/logo-light", headers=headers_a, files=files)
    await client.post("/api/organizations/current/logo-dark", headers=headers_a, files=files)

    response = await client.get("/api/organizations/current", headers=headers_b)
    body = response.json()
    assert body["logo_light_url"] is None
    assert body["logo_dark_url"] is None
