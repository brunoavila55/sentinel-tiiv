import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models.enums import OrganizationRole
from app.models.organization_user import OrganizationUser
from tests.factories import create_org_member


async def _owner_headers(
    db_session: AsyncSession, *, org_name: str = "Org", email: str = "owner@example.com"
) -> tuple[dict, str]:
    member = await create_org_member(db_session, org_name=org_name, email=email, role=OrganizationRole.OWNER)
    token, _ = create_access_token(member.user.id)
    return {"Authorization": f"Bearer {token}", "X-Organization-Id": str(member.organization.id)}, str(
        member.organization.id
    )


async def test_creating_site_and_asset_writes_audit_entries(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, _org_id = await _owner_headers(db_session)
    site = await client.post("/api/sites", headers=headers, json={"name": "Matriz"})
    site_id = site.json()["id"]
    await client.post("/api/assets", headers=headers, json={"name": "sw", "site_id": site_id, "ip_address": "10.0.0.1"})

    logs = await client.get("/api/audit-logs", headers=headers)
    assert logs.status_code == 200
    actions = [entry["action"] for entry in logs.json()]
    assert "site.created" in actions
    assert "asset.created" in actions

    site_entry = next(e for e in logs.json() if e["action"] == "site.created")
    assert site_entry["entity_type"] == "site"
    assert site_entry["metadata"] == {"name": "Matriz"}
    assert site_entry["user_name"] == "owner"


async def test_check_disable_is_a_distinct_action_from_generic_update(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers, _org_id = await _owner_headers(db_session)
    site = await client.post("/api/sites", headers=headers, json={"name": "Matriz"})
    asset = await client.post(
        "/api/assets", headers=headers, json={"name": "sw", "site_id": site.json()["id"], "ip_address": "10.0.0.1"}
    )
    asset_id = asset.json()["id"]
    check = await client.post(f"/api/assets/{asset_id}/checks", headers=headers, json={})
    check_id = check.json()["id"]

    await client.patch(f"/api/assets/{asset_id}/checks/{check_id}", headers=headers, json={"enabled": False})

    logs = await client.get("/api/audit-logs", headers=headers)
    actions = [entry["action"] for entry in logs.json()]
    assert "check.created" in actions
    assert "check.disabled" in actions
    assert "check.updated" not in actions  # foi só desabilitar, não um update genérico


async def test_role_change_and_removal_are_audited(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, org_id = await _owner_headers(db_session)
    other = await create_org_member(db_session, org_name="ignorado", email="other@example.com", role=OrganizationRole.VIEWER)
    db_session.add(
        OrganizationUser(organization_id=uuid.UUID(org_id), user_id=other.user.id, role=OrganizationRole.VIEWER)
    )
    await db_session.commit()

    await client.patch(
        f"/api/organizations/members/{other.user.id}", headers=headers, json={"role": "operator"}
    )
    await client.delete(f"/api/organizations/members/{other.user.id}", headers=headers)

    logs = await client.get("/api/audit-logs", headers=headers)
    actions = [entry["action"] for entry in logs.json()]
    assert "user.role_changed" in actions
    assert "user.removed" in actions

    role_change_entry = next(e for e in logs.json() if e["action"] == "user.role_changed")
    assert role_change_entry["metadata"] == {"old_role": "viewer", "new_role": "operator"}


async def test_audit_logs_never_contain_password_or_token_fields(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers, _org_id = await _owner_headers(db_session)
    await client.post(
        "/api/organizations/invites", headers=headers, json={"email": "convidado@example.com", "role": "viewer"}
    )

    logs = await client.get("/api/audit-logs", headers=headers)
    for entry in logs.json():
        metadata = entry["metadata"] or {}
        blob = str(metadata).lower()
        assert "password" not in blob
        assert "token" not in blob
        assert "secret" not in blob


async def test_only_owner_and_admin_can_read_audit_logs(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, org_id = await _owner_headers(db_session)
    viewer = await create_org_member(db_session, org_name="ignorado", email="viewer@example.com", role=OrganizationRole.VIEWER)
    db_session.add(
        OrganizationUser(organization_id=uuid.UUID(org_id), user_id=viewer.user.id, role=OrganizationRole.VIEWER)
    )
    await db_session.commit()

    viewer_token, _ = create_access_token(viewer.user.id)
    viewer_headers = {"Authorization": f"Bearer {viewer_token}", "X-Organization-Id": org_id}

    denied = await client.get("/api/audit-logs", headers=viewer_headers)
    assert denied.status_code == 403

    allowed = await client.get("/api/audit-logs", headers=headers)
    assert allowed.status_code == 200


async def test_audit_logs_isolated_between_organizations(client: AsyncClient, db_session: AsyncSession) -> None:
    headers_a, _org_a = await _owner_headers(db_session, org_name="Org A", email="a@example.com")
    headers_b, _org_b = await _owner_headers(db_session, org_name="Org B", email="b@example.com")

    await client.post("/api/sites", headers=headers_a, json={"name": "Site A"})

    logs_b = await client.get("/api/audit-logs", headers=headers_b)
    actions_b = [entry["action"] for entry in logs_b.json()]
    assert "site.created" not in actions_b
