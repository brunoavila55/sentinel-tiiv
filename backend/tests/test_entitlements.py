import io

from httpx import AsyncClient
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models.enums import OrganizationRole
from app.services import entitlement_service
from tests.factories import create_org_member


def _image_bytes() -> bytes:
    img = Image.new("RGB", (8, 8), color=(1, 2, 3))
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


async def _org_headers(db_session: AsyncSession, *, org_name: str, email: str) -> tuple[dict, str]:
    member = await create_org_member(db_session, org_name=org_name, email=email, role=OrganizationRole.OWNER)
    token, _ = create_access_token(member.user.id)
    headers = {"Authorization": f"Bearer {token}", "X-Organization-Id": str(member.organization.id)}
    return headers, str(member.organization.id)


def test_get_plan_limits_falls_back_to_free_for_unknown_plan() -> None:
    limits = entitlement_service.get_plan_limits("nao-existe")
    assert limits == entitlement_service.PLAN_LIMITS["free"]


def test_business_plan_has_no_limits() -> None:
    limits = entitlement_service.get_plan_limits("business")
    assert limits.max_assets is None
    assert limits.max_users is None
    assert limits.max_storage_bytes is None


async def test_asset_creation_blocked_at_plan_limit(client: AsyncClient, db_session: AsyncSession, monkeypatch) -> None:
    monkeypatch.setitem(
        entitlement_service.PLAN_LIMITS,
        "free",
        entitlement_service.PlanLimits(max_assets=2, max_users=3, max_storage_bytes=100 * 1024 * 1024, history_retention_days=7),
    )

    headers, _org_id = await _org_headers(db_session, org_name="Org", email="owner@example.com")
    site = await client.post("/api/sites", headers=headers, json={"name": "Matriz"})
    site_id = site.json()["id"]

    for i in range(2):
        response = await client.post(
            "/api/assets", headers=headers, json={"name": f"a{i}", "site_id": site_id, "ip_address": f"10.0.0.{i}"}
        )
        assert response.status_code == 201

    blocked = await client.post(
        "/api/assets", headers=headers, json={"name": "a-over-limit", "site_id": site_id, "ip_address": "10.0.0.99"}
    )
    assert blocked.status_code == 402
    body = blocked.json()["detail"]
    assert body["error"] == "entitlement_limit_reached"
    assert body["limit_type"] == "assets"
    assert body["limit"] == 2
    assert body["current"] == 2


async def test_invite_creation_blocked_when_user_limit_reached(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
) -> None:
    monkeypatch.setitem(
        entitlement_service.PLAN_LIMITS,
        "free",
        entitlement_service.PlanLimits(max_assets=10, max_users=1, max_storage_bytes=100 * 1024 * 1024, history_retention_days=7),
    )

    headers, _org_id = await _org_headers(db_session, org_name="Org", email="owner@example.com")

    # já existe 1 membro (o owner) == limite de 1: convite deve ser bloqueado.
    response = await client.post(
        "/api/organizations/invites", headers=headers, json={"email": "novo@example.com", "role": "viewer"}
    )
    assert response.status_code == 402
    assert response.json()["detail"]["limit_type"] == "users"


async def test_photo_upload_blocked_when_storage_limit_reached(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
) -> None:
    monkeypatch.setitem(
        entitlement_service.PLAN_LIMITS,
        "free",
        entitlement_service.PlanLimits(max_assets=10, max_users=3, max_storage_bytes=10, history_retention_days=7),
    )

    headers, _org_id = await _org_headers(db_session, org_name="Org", email="owner@example.com")
    site = await client.post("/api/sites", headers=headers, json={"name": "Matriz"})
    asset = await client.post(
        "/api/assets", headers=headers, json={"name": "sw", "site_id": site.json()["id"], "ip_address": "10.0.0.1"}
    )
    asset_id = asset.json()["id"]

    files = {"file": ("foto.png", _image_bytes(), "image/png")}
    response = await client.post(f"/api/assets/{asset_id}/photos", headers=headers, files=files)
    assert response.status_code == 402
    assert response.json()["detail"]["limit_type"] == "storage_bytes"
