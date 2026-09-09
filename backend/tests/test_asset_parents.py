from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import OrganizationRole
from tests.factories import create_org_member


async def _headers(db_session: AsyncSession, *, org_name: str, email: str, role: OrganizationRole = OrganizationRole.OWNER):
    from app.core.security import create_access_token

    member = await create_org_member(db_session, org_name=org_name, email=email, role=role)
    token, _ = create_access_token(member.user.id)
    return {"Authorization": f"Bearer {token}", "X-Organization-Id": str(member.organization.id)}


async def _create_site(client: AsyncClient, headers: dict, name: str = "Matriz") -> str:
    response = await client.post("/api/sites", headers=headers, json={"name": name})
    return response.json()["id"]


async def _create_asset(client: AsyncClient, headers: dict, site_id: str, name: str, parent_asset_id: str | None = None) -> dict:
    payload = {"name": name, "site_id": site_id, "ip_address": f"10.0.0.{abs(hash(name)) % 200 + 1}"}
    if parent_asset_id is not None:
        payload["parent_asset_id"] = parent_asset_id
    response = await client.post("/api/assets", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


async def test_create_asset_with_parent_creates_topology_link(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _headers(db_session, org_name="Org", email="o@example.com")
    site_id = await _create_site(client, headers)

    core = await _create_asset(client, headers, site_id, "core-sw")
    leaf = await _create_asset(client, headers, site_id, "sw-01", parent_asset_id=core["id"])

    assert leaf["parent_asset_id"] == core["id"]

    topology = await client.get("/api/topology", headers=headers, params={"site_id": site_id})
    edges = topology.json()["edges"]
    assert len(edges) == 1
    assert edges[0]["source_asset_id"] == core["id"]
    assert edges[0]["target_asset_id"] == leaf["id"]
    assert edges[0]["link_type"] == "parent"


async def test_update_asset_parent_replaces_previous_link(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _headers(db_session, org_name="Org", email="o@example.com")
    site_id = await _create_site(client, headers)

    core_a = await _create_asset(client, headers, site_id, "core-a")
    core_b = await _create_asset(client, headers, site_id, "core-b")
    leaf = await _create_asset(client, headers, site_id, "leaf", parent_asset_id=core_a["id"])

    response = await client.patch(
        f"/api/assets/{leaf['id']}", headers=headers, json={"parent_asset_id": core_b["id"]}
    )
    assert response.status_code == 200
    assert response.json()["parent_asset_id"] == core_b["id"]

    topology = await client.get("/api/topology", headers=headers, params={"site_id": site_id})
    edges = topology.json()["edges"]
    assert len(edges) == 1
    assert edges[0]["source_asset_id"] == core_b["id"]


async def test_clear_asset_parent_removes_link(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _headers(db_session, org_name="Org", email="o@example.com")
    site_id = await _create_site(client, headers)

    core = await _create_asset(client, headers, site_id, "core")
    leaf = await _create_asset(client, headers, site_id, "leaf", parent_asset_id=core["id"])

    response = await client.patch(f"/api/assets/{leaf['id']}", headers=headers, json={"parent_asset_id": None})
    assert response.status_code == 200
    assert response.json()["parent_asset_id"] is None

    topology = await client.get("/api/topology", headers=headers, params={"site_id": site_id})
    assert topology.json()["edges"] == []


async def test_asset_cannot_be_its_own_parent(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _headers(db_session, org_name="Org", email="o@example.com")
    site_id = await _create_site(client, headers)
    asset = await _create_asset(client, headers, site_id, "solo")

    response = await client.patch(
        f"/api/assets/{asset['id']}", headers=headers, json={"parent_asset_id": asset["id"]}
    )
    assert response.status_code == 422


async def test_parent_must_be_in_same_site(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _headers(db_session, org_name="Org", email="o@example.com")
    site_a = await _create_site(client, headers, name="Matriz")
    site_b = await _create_site(client, headers, name="Filial")

    parent = await _create_asset(client, headers, site_a, "core")
    child = await _create_asset(client, headers, site_b, "leaf")

    response = await client.patch(
        f"/api/assets/{child['id']}", headers=headers, json={"parent_asset_id": parent["id"]}
    )
    assert response.status_code == 422


async def test_setting_parent_rejects_cycle(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _headers(db_session, org_name="Org", email="o@example.com")
    site_id = await _create_site(client, headers)

    a = await _create_asset(client, headers, site_id, "a")
    b = await _create_asset(client, headers, site_id, "b", parent_asset_id=a["id"])

    response = await client.patch(f"/api/assets/{a['id']}", headers=headers, json={"parent_asset_id": b["id"]})
    assert response.status_code == 422


async def test_asset_from_other_organization_cannot_be_used_as_parent(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers_a = await _headers(db_session, org_name="Org A", email="a@example.com")
    headers_b = await _headers(db_session, org_name="Org B", email="b@example.com")

    site_a = await _create_site(client, headers_a)
    asset_a = await _create_asset(client, headers_a, site_a, "a-asset")

    site_b = await _create_site(client, headers_b)
    asset_b = await _create_asset(client, headers_b, site_b, "b-asset")

    response = await client.patch(
        f"/api/assets/{asset_b['id']}", headers=headers_b, json={"parent_asset_id": asset_a["id"]}
    )
    assert response.status_code == 404


async def test_manual_topology_link_rejects_second_parent(client: AsyncClient, db_session: AsyncSession) -> None:
    headers = await _headers(db_session, org_name="Org", email="o@example.com")
    site_id = await _create_site(client, headers)

    core_a = await _create_asset(client, headers, site_id, "core-a")
    core_b = await _create_asset(client, headers, site_id, "core-b")
    leaf = await _create_asset(client, headers, site_id, "leaf", parent_asset_id=core_a["id"])

    response = await client.post(
        "/api/topology/links",
        headers=headers,
        json={
            "site_id": site_id,
            "source_asset_id": core_b["id"],
            "target_asset_id": leaf["id"],
            "link_type": "parent",
        },
    )
    assert response.status_code == 409
