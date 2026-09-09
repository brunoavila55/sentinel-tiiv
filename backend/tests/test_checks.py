from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models.enums import OrganizationRole
from tests.factories import create_org_member


async def _asset_headers(
    client: AsyncClient, db_session: AsyncSession, *, org_name: str, email: str, role: OrganizationRole = OrganizationRole.OWNER
) -> tuple[dict, str]:
    member = await create_org_member(db_session, org_name=org_name, email=email, role=role)
    token, _ = create_access_token(member.user.id)
    headers = {"Authorization": f"Bearer {token}", "X-Organization-Id": str(member.organization.id)}
    site = await client.post("/api/sites", headers=headers, json={"name": "Matriz"})
    asset = await client.post(
        "/api/assets", headers=headers, json={"name": "sw", "site_id": site.json()["id"], "ip_address": "10.0.0.1"}
    )
    return headers, asset.json()["id"]


async def test_create_check_defaults_and_is_due_immediately(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, asset_id = await _asset_headers(client, db_session, org_name="Org", email="owner@example.com")

    response = await client.post(f"/api/assets/{asset_id}/checks", headers=headers, json={})
    assert response.status_code == 201
    body = response.json()
    assert body["type"] == "ping"
    assert body["enabled"] is True
    assert body["next_check_at"] is not None  # due imediatamente
    assert body["consecutive_successes"] == 0
    assert body["consecutive_failures"] == 0


async def test_create_check_rejects_unsupported_type(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, asset_id = await _asset_headers(client, db_session, org_name="Org", email="owner@example.com")
    response = await client.post(f"/api/assets/{asset_id}/checks", headers=headers, json={"type": "http"})
    assert response.status_code == 422


async def test_create_check_rejects_interval_out_of_bounds(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, asset_id = await _asset_headers(client, db_session, org_name="Org", email="owner@example.com")
    too_low = await client.post(f"/api/assets/{asset_id}/checks", headers=headers, json={"interval_seconds": 1})
    assert too_low.status_code == 422
    too_high = await client.post(f"/api/assets/{asset_id}/checks", headers=headers, json={"interval_seconds": 999999})
    assert too_high.status_code == 422


async def test_disabling_check_clears_next_check_at_and_reenabling_makes_it_due(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers, asset_id = await _asset_headers(client, db_session, org_name="Org", email="owner@example.com")
    created = await client.post(f"/api/assets/{asset_id}/checks", headers=headers, json={})
    check_id = created.json()["id"]

    disabled = await client.patch(f"/api/assets/{asset_id}/checks/{check_id}", headers=headers, json={"enabled": False})
    assert disabled.json()["next_check_at"] is None

    reenabled = await client.patch(f"/api/assets/{asset_id}/checks/{check_id}", headers=headers, json={"enabled": True})
    assert reenabled.json()["next_check_at"] is not None


async def test_operator_can_manage_checks_viewer_cannot(client: AsyncClient, db_session: AsyncSession) -> None:
    owner_headers, asset_id = await _asset_headers(client, db_session, org_name="Org", email="owner@example.com")
    org_id = owner_headers["X-Organization-Id"]

    from app.models.organization_user import OrganizationUser
    import uuid as uuid_module

    operator = await create_org_member(db_session, org_name="ignorado", email="op@example.com", role=OrganizationRole.OPERATOR)
    db_session.add(
        OrganizationUser(organization_id=uuid_module.UUID(org_id), user_id=operator.user.id, role=OrganizationRole.OPERATOR)
    )
    viewer = await create_org_member(db_session, org_name="ignorado2", email="view@example.com", role=OrganizationRole.VIEWER)
    db_session.add(
        OrganizationUser(organization_id=uuid_module.UUID(org_id), user_id=viewer.user.id, role=OrganizationRole.VIEWER)
    )
    await db_session.commit()

    op_token, _ = create_access_token(operator.user.id)
    op_headers = {"Authorization": f"Bearer {op_token}", "X-Organization-Id": org_id}
    created = await client.post(f"/api/assets/{asset_id}/checks", headers=op_headers, json={})
    assert created.status_code == 201

    viewer_token, _ = create_access_token(viewer.user.id)
    viewer_headers = {"Authorization": f"Bearer {viewer_token}", "X-Organization-Id": org_id}
    denied = await client.post(f"/api/assets/{asset_id}/checks", headers=viewer_headers, json={})
    assert denied.status_code == 403

    listed = await client.get(f"/api/assets/{asset_id}/checks", headers=viewer_headers)
    assert listed.status_code == 200
    assert len(listed.json()) == 1


async def test_checks_are_isolated_between_organizations(client: AsyncClient, db_session: AsyncSession) -> None:
    headers_a, asset_a = await _asset_headers(client, db_session, org_name="Org A", email="a@example.com")
    headers_b, _asset_b = await _asset_headers(client, db_session, org_name="Org B", email="b@example.com")

    created = await client.post(f"/api/assets/{asset_a}/checks", headers=headers_a, json={})
    check_id = created.json()["id"]

    cross_list = await client.get(f"/api/assets/{asset_a}/checks", headers=headers_b)
    assert cross_list.status_code == 404

    cross_patch = await client.patch(
        f"/api/assets/{asset_a}/checks/{check_id}", headers=headers_b, json={"enabled": False}
    )
    assert cross_patch.status_code == 404

    cross_delete = await client.delete(f"/api/assets/{asset_a}/checks/{check_id}", headers=headers_b)
    assert cross_delete.status_code == 404


async def test_delete_check(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, asset_id = await _asset_headers(client, db_session, org_name="Org", email="owner@example.com")
    created = await client.post(f"/api/assets/{asset_id}/checks", headers=headers, json={})
    check_id = created.json()["id"]

    deleted = await client.delete(f"/api/assets/{asset_id}/checks/{check_id}", headers=headers)
    assert deleted.status_code == 204

    listed = await client.get(f"/api/assets/{asset_id}/checks", headers=headers)
    assert listed.json() == []


async def test_packets_is_a_first_class_field_not_raw_json(client: AsyncClient, db_session: AsyncSession) -> None:
    """Prompt 19: a API nunca expõe `config` cru — packets é campo próprio,
    mapeado internamente pro JSONB de config."""
    headers, asset_id = await _asset_headers(client, db_session, org_name="Org", email="owner@example.com")

    created = await client.post(f"/api/assets/{asset_id}/checks", headers=headers, json={"packets": 5})
    assert created.status_code == 201
    body = created.json()
    assert body["packets"] == 5
    assert "config" not in body

    updated = await client.patch(
        f"/api/assets/{asset_id}/checks/{body['id']}", headers=headers, json={"packets": 7}
    )
    assert updated.json()["packets"] == 7

    too_many = await client.post(f"/api/assets/{asset_id}/checks", headers=headers, json={"packets": 999})
    assert too_many.status_code == 422

    too_few = await client.patch(
        f"/api/assets/{asset_id}/checks/{body['id']}", headers=headers, json={"packets": 0}
    )
    assert too_few.status_code == 422
