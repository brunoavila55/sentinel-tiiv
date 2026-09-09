import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models.asset import Asset
from app.models.enums import OrganizationRole
from tests.factories import create_org_member


async def _headers(db_session: AsyncSession, *, org_name: str, email: str, role: OrganizationRole):
    member = await create_org_member(db_session, org_name=org_name, email=email, role=role)
    token, _ = create_access_token(member.user.id)
    return {"Authorization": f"Bearer {token}", "X-Organization-Id": str(member.organization.id)}, member


async def test_create_and_list_sites(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, _ = await _headers(db_session, org_name="Org", email="owner@example.com", role=OrganizationRole.OWNER)

    create = await client.post("/api/sites", headers=headers, json={"name": "Matriz", "address": "Rua A, 100"})
    assert create.status_code == 201
    body = create.json()
    assert body["name"] == "Matriz"
    assert body["asset_count"] == 0

    listed = await client.get("/api/sites", headers=headers)
    assert listed.status_code == 200
    assert len(listed.json()) == 1


async def test_operator_can_read_but_not_write_sites(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, _ = await _headers(
        db_session, org_name="Org", email="operator@example.com", role=OrganizationRole.OPERATOR
    )

    listed = await client.get("/api/sites", headers=headers)
    assert listed.status_code == 200

    created = await client.post("/api/sites", headers=headers, json={"name": "Matriz"})
    assert created.status_code == 403


async def test_admin_can_manage_sites(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, _ = await _headers(db_session, org_name="Org", email="admin@example.com", role=OrganizationRole.ADMIN)

    create = await client.post("/api/sites", headers=headers, json={"name": "Matriz"})
    site_id = create.json()["id"]

    update = await client.patch(f"/api/sites/{site_id}", headers=headers, json={"description": "CPD principal"})
    assert update.status_code == 200
    assert update.json()["description"] == "CPD principal"

    delete = await client.delete(f"/api/sites/{site_id}", headers=headers)
    assert delete.status_code == 204

    missing = await client.get(f"/api/sites/{site_id}", headers=headers)
    assert missing.status_code == 404


async def test_cannot_delete_site_with_assets(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, member = await _headers(db_session, org_name="Org", email="owner@example.com", role=OrganizationRole.OWNER)

    create = await client.post("/api/sites", headers=headers, json={"name": "Matriz"})
    site_id = create.json()["id"]

    db_session.add(
        Asset(
            organization_id=member.organization.id,
            site_id=uuid.UUID(site_id),
            name="sw-core",
            ip_address="10.0.0.1",
        )
    )
    await db_session.commit()

    delete = await client.delete(f"/api/sites/{site_id}", headers=headers)
    assert delete.status_code == 409

    still_there = await client.get(f"/api/sites/{site_id}", headers=headers)
    assert still_there.json()["asset_count"] == 1


async def test_site_search_filters_by_name(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, _ = await _headers(db_session, org_name="Org", email="owner@example.com", role=OrganizationRole.OWNER)
    await client.post("/api/sites", headers=headers, json={"name": "Matriz"})
    await client.post("/api/sites", headers=headers, json={"name": "Filial Norte"})

    response = await client.get("/api/sites?search=matriz", headers=headers)
    assert [s["name"] for s in response.json()] == ["Matriz"]


async def test_sites_are_isolated_between_organizations(client: AsyncClient, db_session: AsyncSession) -> None:
    headers_a, _ = await _headers(db_session, org_name="Org A", email="a@example.com", role=OrganizationRole.OWNER)
    headers_b, _ = await _headers(db_session, org_name="Org B", email="b@example.com", role=OrganizationRole.OWNER)

    create = await client.post("/api/sites", headers=headers_a, json={"name": "Site da A"})
    site_id = create.json()["id"]

    cross_access = await client.get(f"/api/sites/{site_id}", headers=headers_b)
    assert cross_access.status_code == 404

    listed_b = await client.get("/api/sites", headers=headers_b)
    assert listed_b.json() == []
