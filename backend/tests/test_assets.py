import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models.enums import OrganizationRole
from tests.factories import create_org_member


async def _headers(db_session: AsyncSession, *, org_name: str, email: str, role: OrganizationRole):
    member = await create_org_member(db_session, org_name=org_name, email=email, role=role)
    token, _ = create_access_token(member.user.id)
    return {"Authorization": f"Bearer {token}", "X-Organization-Id": str(member.organization.id)}, member


async def _create_site(client: AsyncClient, headers: dict, name: str = "Matriz") -> str:
    response = await client.post("/api/sites", headers=headers, json={"name": name})
    return response.json()["id"]


async def test_create_asset_requires_hostname_or_ip(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, _ = await _headers(db_session, org_name="Org", email="owner@example.com", role=OrganizationRole.OWNER)
    site_id = await _create_site(client, headers)

    response = await client.post("/api/assets", headers=headers, json={"name": "sw-core", "site_id": site_id})
    assert response.status_code == 422


async def test_create_asset_validates_ip_and_hostname(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, _ = await _headers(db_session, org_name="Org", email="owner@example.com", role=OrganizationRole.OWNER)
    site_id = await _create_site(client, headers)

    bad_ip = await client.post(
        "/api/assets", headers=headers, json={"name": "x", "site_id": site_id, "ip_address": "999.999.1.1"}
    )
    assert bad_ip.status_code == 422

    bad_hostname = await client.post(
        "/api/assets", headers=headers, json={"name": "x", "site_id": site_id, "hostname": "-bad-.example..com"}
    )
    assert bad_hostname.status_code == 422

    ok_ipv6 = await client.post(
        "/api/assets", headers=headers, json={"name": "x", "site_id": site_id, "ip_address": "2001:db8::1"}
    )
    assert ok_ipv6.status_code == 201
    assert ok_ipv6.json()["ip_address"] == "2001:db8::1"


async def test_create_asset_requires_site_from_same_organization(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers_a, _ = await _headers(db_session, org_name="Org A", email="a@example.com", role=OrganizationRole.OWNER)
    headers_b, _ = await _headers(db_session, org_name="Org B", email="b@example.com", role=OrganizationRole.OWNER)
    site_b = await _create_site(client, headers_b)

    response = await client.post(
        "/api/assets", headers=headers_a, json={"name": "x", "site_id": site_b, "ip_address": "10.0.0.1"}
    )
    assert response.status_code == 404


async def test_operator_can_manage_assets_but_viewer_cannot(client: AsyncClient, db_session: AsyncSession) -> None:
    owner_headers, member = await _headers(
        db_session, org_name="Org", email="owner@example.com", role=OrganizationRole.OWNER
    )
    site_id = await _create_site(client, owner_headers)

    from app.models.organization_user import OrganizationUser

    operator = await create_org_member(db_session, org_name="ignorado", email="op@example.com", role=OrganizationRole.OPERATOR)
    db_session.add(
        OrganizationUser(organization_id=member.organization.id, user_id=operator.user.id, role=OrganizationRole.OPERATOR)
    )
    viewer = await create_org_member(db_session, org_name="ignorado2", email="viewer@example.com", role=OrganizationRole.VIEWER)
    db_session.add(
        OrganizationUser(organization_id=member.organization.id, user_id=viewer.user.id, role=OrganizationRole.VIEWER)
    )
    await db_session.commit()

    op_token, _ = create_access_token(operator.user.id)
    op_headers = {"Authorization": f"Bearer {op_token}", "X-Organization-Id": str(member.organization.id)}
    created = await client.post(
        "/api/assets", headers=op_headers, json={"name": "sw-1", "site_id": site_id, "ip_address": "10.0.0.2"}
    )
    assert created.status_code == 201

    viewer_token, _ = create_access_token(viewer.user.id)
    viewer_headers = {"Authorization": f"Bearer {viewer_token}", "X-Organization-Id": str(member.organization.id)}
    denied = await client.post(
        "/api/assets", headers=viewer_headers, json={"name": "sw-2", "site_id": site_id, "ip_address": "10.0.0.3"}
    )
    assert denied.status_code == 403

    listed = await client.get("/api/assets", headers=viewer_headers)
    assert listed.status_code == 200
    assert listed.json()["total"] == 1


async def test_update_asset_cannot_clear_both_hostname_and_ip(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers, _ = await _headers(db_session, org_name="Org", email="owner@example.com", role=OrganizationRole.OWNER)
    site_id = await _create_site(client, headers)
    created = await client.post(
        "/api/assets", headers=headers, json={"name": "x", "site_id": site_id, "ip_address": "10.0.0.1"}
    )
    asset_id = created.json()["id"]

    response = await client.patch(f"/api/assets/{asset_id}", headers=headers, json={"ip_address": None})
    assert response.status_code == 422

    ok = await client.patch(
        f"/api/assets/{asset_id}", headers=headers, json={"hostname": "sw1.example.com", "ip_address": None}
    )
    assert ok.status_code == 200
    assert ok.json()["ip_address"] is None
    assert ok.json()["hostname"] == "sw1.example.com"


async def test_list_assets_search_filter_and_pagination(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, _ = await _headers(db_session, org_name="Org", email="owner@example.com", role=OrganizationRole.OWNER)
    site_id = await _create_site(client, headers)

    for i in range(5):
        await client.post(
            "/api/assets", headers=headers, json={"name": f"sw-{i}", "site_id": site_id, "ip_address": f"10.0.0.{i}"}
        )

    page1 = await client.get("/api/assets?limit=2&offset=0", headers=headers)
    assert page1.status_code == 200
    assert page1.json()["total"] == 5
    assert len(page1.json()["items"]) == 2

    page2 = await client.get("/api/assets?limit=2&offset=2", headers=headers)
    assert len(page2.json()["items"]) == 2
    assert {a["id"] for a in page1.json()["items"]}.isdisjoint({a["id"] for a in page2.json()["items"]})

    search = await client.get("/api/assets?search=sw-3", headers=headers)
    assert [a["name"] for a in search.json()["items"]] == ["sw-3"]

    disabled = await client.get("/api/assets?enabled=false", headers=headers)
    assert disabled.json()["total"] == 0


async def test_assets_are_isolated_between_organizations(client: AsyncClient, db_session: AsyncSession) -> None:
    headers_a, _ = await _headers(db_session, org_name="Org A", email="a@example.com", role=OrganizationRole.OWNER)
    headers_b, _ = await _headers(db_session, org_name="Org B", email="b@example.com", role=OrganizationRole.OWNER)
    site_a = await _create_site(client, headers_a)

    created = await client.post(
        "/api/assets", headers=headers_a, json={"name": "x", "site_id": site_a, "ip_address": "10.0.0.1"}
    )
    asset_id = created.json()["id"]

    cross = await client.get(f"/api/assets/{asset_id}", headers=headers_b)
    assert cross.status_code == 404

    delete_cross = await client.delete(f"/api/assets/{asset_id}", headers=headers_b)
    assert delete_cross.status_code == 404


async def test_delete_asset(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, _ = await _headers(db_session, org_name="Org", email="owner@example.com", role=OrganizationRole.OWNER)
    site_id = await _create_site(client, headers)
    created = await client.post(
        "/api/assets", headers=headers, json={"name": "x", "site_id": site_id, "ip_address": "10.0.0.1"}
    )
    asset_id = created.json()["id"]

    deleted = await client.delete(f"/api/assets/{asset_id}", headers=headers)
    assert deleted.status_code == 204

    missing = await client.get(f"/api/assets/{asset_id}", headers=headers)
    assert missing.status_code == 404


async def test_unknown_asset_returns_404_not_500(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, _ = await _headers(db_session, org_name="Org", email="owner@example.com", role=OrganizationRole.OWNER)
    response = await client.get(f"/api/assets/{uuid.uuid4()}", headers=headers)
    assert response.status_code == 404


async def test_list_assets_sort_by_name(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, _ = await _headers(db_session, org_name="Org", email="owner@example.com", role=OrganizationRole.OWNER)
    site_id = await _create_site(client, headers)

    for name, ip in [("charlie", "10.0.0.3"), ("alpha", "10.0.0.1"), ("bravo", "10.0.0.2")]:
        await client.post("/api/assets", headers=headers, json={"name": name, "site_id": site_id, "ip_address": ip})

    asc = await client.get("/api/assets?sort=name", headers=headers)
    assert [a["name"] for a in asc.json()["items"]] == ["alpha", "bravo", "charlie"]

    desc = await client.get("/api/assets?sort=-name", headers=headers)
    assert [a["name"] for a in desc.json()["items"]] == ["charlie", "bravo", "alpha"]

    unknown_sort = await client.get("/api/assets?sort=not-a-real-column", headers=headers)
    assert unknown_sort.status_code == 200
    assert [a["name"] for a in unknown_sort.json()["items"]] == ["alpha", "bravo", "charlie"]
