import io
import uuid

from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.core.storage import get_storage_service
from app.models.asset_photo import AssetPhoto
from app.models.enums import OrganizationRole
from tests.factories import create_org_member


def _image_bytes(fmt: str = "PNG", size: tuple[int, int] = (8, 8)) -> bytes:
    img = Image.new("RGB", size, color=(10, 20, 30))
    buffer = io.BytesIO()
    img.save(buffer, format=fmt)
    return buffer.getvalue()


async def _asset_headers(
    client: AsyncClient,
    db_session: AsyncSession,
    *,
    org_name: str,
    email: str,
    role: OrganizationRole = OrganizationRole.OWNER,
) -> tuple[dict, str]:
    member = await create_org_member(db_session, org_name=org_name, email=email, role=role)
    token, _ = create_access_token(member.user.id)
    headers = {"Authorization": f"Bearer {token}", "X-Organization-Id": str(member.organization.id)}
    site = await client.post("/api/sites", headers=headers, json={"name": "Matriz"})
    asset = await client.post(
        "/api/assets", headers=headers, json={"name": "sw", "site_id": site.json()["id"], "ip_address": "10.0.0.1"}
    )
    return headers, asset.json()["id"]


async def _photo_row(db_session: AsyncSession, photo_id: str) -> AssetPhoto:
    result = await db_session.execute(select(AssetPhoto).where(AssetPhoto.id == uuid.UUID(photo_id)))
    return result.scalar_one()


async def test_upload_list_and_delete_photo_removes_from_storage(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers, asset_id = await _asset_headers(client, db_session, org_name="Org", email="owner@example.com")

    files = {"file": ("foto.png", _image_bytes(), "image/png")}
    upload = await client.post(
        f"/api/assets/{asset_id}/photos", headers=headers, files=files, data={"caption": "Rack"}
    )
    assert upload.status_code == 201
    body = upload.json()
    assert body["is_primary"] is True
    assert body["caption"] == "Rack"
    assert body["url"].startswith("http://")
    assert "_thumb.jpg" in body["thumbnail_url"]

    photo = await _photo_row(db_session, body["id"])
    storage = get_storage_service()
    assert await storage.exists(photo.storage_key)
    assert await storage.exists(photo.thumbnail_storage_key)

    listed = await client.get(f"/api/assets/{asset_id}/photos", headers=headers)
    assert len(listed.json()) == 1

    deleted = await client.delete(f"/api/assets/{asset_id}/photos/{body['id']}", headers=headers)
    assert deleted.status_code == 204
    assert not await storage.exists(photo.storage_key)
    assert not await storage.exists(photo.thumbnail_storage_key)


async def test_rejects_invalid_mime_type(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, asset_id = await _asset_headers(client, db_session, org_name="Org", email="owner@example.com")
    files = {"file": ("foto.gif", b"GIF89a", "image/gif")}
    response = await client.post(f"/api/assets/{asset_id}/photos", headers=headers, files=files)
    assert response.status_code == 422


async def test_rejects_content_mismatched_with_declared_mime(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers, asset_id = await _asset_headers(client, db_session, org_name="Org", email="owner@example.com")
    # PNG de verdade, cabeçalho declarando JPEG.
    files = {"file": ("foto.jpg", _image_bytes("PNG"), "image/jpeg")}
    response = await client.post(f"/api/assets/{asset_id}/photos", headers=headers, files=files)
    assert response.status_code == 422


async def test_viewer_cannot_upload_photo(client: AsyncClient, db_session: AsyncSession) -> None:
    owner_headers, asset_id = await _asset_headers(
        client, db_session, org_name="Org", email="owner@example.com"
    )
    org_id = owner_headers["X-Organization-Id"]

    viewer = await create_org_member(db_session, org_name="ignorado", email="viewer@example.com", role=OrganizationRole.VIEWER)
    from app.models.organization_user import OrganizationUser

    db_session.add(
        OrganizationUser(organization_id=uuid.UUID(org_id), user_id=viewer.user.id, role=OrganizationRole.VIEWER)
    )
    await db_session.commit()

    viewer_token, _ = create_access_token(viewer.user.id)
    viewer_headers = {"Authorization": f"Bearer {viewer_token}", "X-Organization-Id": org_id}

    files = {"file": ("foto.png", _image_bytes(), "image/png")}
    response = await client.post(f"/api/assets/{asset_id}/photos", headers=viewer_headers, files=files)
    assert response.status_code == 403


async def test_reorder_changes_primary_photo(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, asset_id = await _asset_headers(client, db_session, org_name="Org", email="owner@example.com")

    ids = []
    for _ in range(3):
        files = {"file": ("foto.png", _image_bytes(), "image/png")}
        response = await client.post(f"/api/assets/{asset_id}/photos", headers=headers, files=files)
        ids.append(response.json()["id"])

    listed = await client.get(f"/api/assets/{asset_id}/photos", headers=headers)
    positions = {p["id"]: p["position"] for p in listed.json()}
    assert positions[ids[0]] == 0

    reordered = await client.patch(f"/api/assets/{asset_id}/photos/{ids[2]}", headers=headers, json={"position": 0})
    assert reordered.status_code == 200
    assert reordered.json()["is_primary"] is True

    listed_after = await client.get(f"/api/assets/{asset_id}/photos", headers=headers)
    positions_after = {p["id"]: p["position"] for p in listed_after.json()}
    assert positions_after[ids[2]] == 0
    assert positions_after[ids[0]] == 1
    assert positions_after[ids[1]] == 2


async def test_photo_isolation_between_organizations(client: AsyncClient, db_session: AsyncSession) -> None:
    """Requisito explícito do Prompt 08: cliente B não acessa foto do
    cliente A de nenhuma forma, mesmo sabendo asset_id e photo_id."""
    headers_a, asset_id = await _asset_headers(client, db_session, org_name="Org A", email="a@example.com")
    files = {"file": ("foto.png", _image_bytes(), "image/png")}
    upload = await client.post(f"/api/assets/{asset_id}/photos", headers=headers_a, files=files)
    photo_id = upload.json()["id"]

    headers_b, _ = await _asset_headers(client, db_session, org_name="Org B", email="b@example.com")

    listed = await client.get(f"/api/assets/{asset_id}/photos", headers=headers_b)
    assert listed.status_code == 404

    patched = await client.patch(
        f"/api/assets/{asset_id}/photos/{photo_id}", headers=headers_b, json={"caption": "hack"}
    )
    assert patched.status_code == 404

    deleted = await client.delete(f"/api/assets/{asset_id}/photos/{photo_id}", headers=headers_b)
    assert deleted.status_code == 404

    # a foto do cliente A continua intacta.
    still_there = await client.get(f"/api/assets/{asset_id}/photos", headers=headers_a)
    assert len(still_there.json()) == 1
