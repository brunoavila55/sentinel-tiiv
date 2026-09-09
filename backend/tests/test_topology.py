import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models.asset import Asset
from app.models.enums import OrganizationRole
from app.models.site import Site
from tests.factories import create_org_member


async def _org_with_two_assets(
    db_session: AsyncSession, *, org_name: str, email: str
) -> tuple[dict, uuid.UUID, Asset, Asset]:
    member = await create_org_member(db_session, org_name=org_name, email=email, role=OrganizationRole.OWNER)
    token, _ = create_access_token(member.user.id)
    headers = {"Authorization": f"Bearer {token}", "X-Organization-Id": str(member.organization.id)}

    site = Site(organization_id=member.organization.id, name="Matriz")
    db_session.add(site)
    await db_session.flush()

    asset_a = Asset(organization_id=member.organization.id, site_id=site.id, name="a", ip_address="10.0.0.1")
    asset_b = Asset(organization_id=member.organization.id, site_id=site.id, name="b", ip_address="10.0.0.2")
    db_session.add_all([asset_a, asset_b])
    await db_session.commit()
    await db_session.refresh(asset_a)
    await db_session.refresh(asset_b)
    return headers, site.id, asset_a, asset_b


async def test_get_topology_returns_nodes_and_edges(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, site_id, asset_a, asset_b = await _org_with_two_assets(db_session, org_name="Org", email="o@example.com")

    link = await client.post(
        "/api/topology/links",
        headers=headers,
        json={"site_id": str(site_id), "source_asset_id": str(asset_a.id), "target_asset_id": str(asset_b.id)},
    )
    assert link.status_code == 201

    response = await client.get("/api/topology", headers=headers, params={"site_id": str(site_id)})
    assert response.status_code == 200
    body = response.json()
    assert len(body["nodes"]) == 2
    assert len(body["edges"]) == 1
    node = next(n for n in body["nodes"] if n["id"] == str(asset_a.id))
    assert node["ip"] == "10.0.0.1"
    assert node["has_photo"] is False
    assert node["site"] == "Matriz"


async def test_cannot_create_self_link(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, site_id, asset_a, _asset_b = await _org_with_two_assets(
        db_session, org_name="Org", email="o@example.com"
    )
    response = await client.post(
        "/api/topology/links",
        headers=headers,
        json={"site_id": str(site_id), "source_asset_id": str(asset_a.id), "target_asset_id": str(asset_a.id)},
    )
    assert response.status_code == 422


async def test_duplicate_link_rejected_in_both_directions(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, site_id, asset_a, asset_b = await _org_with_two_assets(db_session, org_name="Org", email="o@example.com")

    first = await client.post(
        "/api/topology/links",
        headers=headers,
        json={"site_id": str(site_id), "source_asset_id": str(asset_a.id), "target_asset_id": str(asset_b.id)},
    )
    assert first.status_code == 201

    same_direction = await client.post(
        "/api/topology/links",
        headers=headers,
        json={"site_id": str(site_id), "source_asset_id": str(asset_a.id), "target_asset_id": str(asset_b.id)},
    )
    assert same_direction.status_code == 409

    reverse_direction = await client.post(
        "/api/topology/links",
        headers=headers,
        json={"site_id": str(site_id), "source_asset_id": str(asset_b.id), "target_asset_id": str(asset_a.id)},
    )
    assert reverse_direction.status_code == 409


async def test_link_rejects_asset_from_another_site(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, site_id, asset_a, _ = await _org_with_two_assets(db_session, org_name="Org", email="o@example.com")

    other_site = Site(organization_id=uuid.UUID(headers["X-Organization-Id"]), name="Filial")
    db_session.add(other_site)
    await db_session.flush()
    other_asset = Asset(
        organization_id=uuid.UUID(headers["X-Organization-Id"]), site_id=other_site.id, name="c", ip_address="10.0.0.9"
    )
    db_session.add(other_asset)
    await db_session.commit()
    await db_session.refresh(other_asset)

    response = await client.post(
        "/api/topology/links",
        headers=headers,
        json={"site_id": str(site_id), "source_asset_id": str(asset_a.id), "target_asset_id": str(other_asset.id)},
    )
    assert response.status_code == 422


async def test_link_rejects_asset_from_another_organization(client: AsyncClient, db_session: AsyncSession) -> None:
    headers_a, site_a, asset_a, _ = await _org_with_two_assets(db_session, org_name="Org A", email="a@example.com")
    _headers_b, _site_b, asset_b_of_org_b, _ = await _org_with_two_assets(
        db_session, org_name="Org B", email="b@example.com"
    )

    response = await client.post(
        "/api/topology/links",
        headers=headers_a,
        json={
            "site_id": str(site_a),
            "source_asset_id": str(asset_a.id),
            "target_asset_id": str(asset_b_of_org_b.id),
        },
    )
    assert response.status_code == 404


async def test_viewer_cannot_create_link_but_can_read_topology(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers, site_id, asset_a, asset_b = await _org_with_two_assets(
        db_session, org_name="Org", email="owner@example.com"
    )
    org_id = owner_headers["X-Organization-Id"]

    from app.models.organization_user import OrganizationUser

    viewer = await create_org_member(db_session, org_name="ignorado", email="viewer@example.com", role=OrganizationRole.VIEWER)
    db_session.add(
        OrganizationUser(organization_id=uuid.UUID(org_id), user_id=viewer.user.id, role=OrganizationRole.VIEWER)
    )
    await db_session.commit()

    viewer_token, _ = create_access_token(viewer.user.id)
    viewer_headers = {"Authorization": f"Bearer {viewer_token}", "X-Organization-Id": org_id}

    denied = await client.post(
        "/api/topology/links",
        headers=viewer_headers,
        json={"site_id": str(site_id), "source_asset_id": str(asset_a.id), "target_asset_id": str(asset_b.id)},
    )
    assert denied.status_code == 403

    read = await client.get("/api/topology", headers=viewer_headers, params={"site_id": str(site_id)})
    assert read.status_code == 200


async def test_delete_link(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, site_id, asset_a, asset_b = await _org_with_two_assets(db_session, org_name="Org", email="o@example.com")
    created = await client.post(
        "/api/topology/links",
        headers=headers,
        json={"site_id": str(site_id), "source_asset_id": str(asset_a.id), "target_asset_id": str(asset_b.id)},
    )
    link_id = created.json()["id"]

    deleted = await client.delete(f"/api/topology/links/{link_id}", headers=headers)
    assert deleted.status_code == 204

    response = await client.get("/api/topology", headers=headers, params={"site_id": str(site_id)})
    assert response.json()["edges"] == []


async def test_topology_isolated_between_organizations(client: AsyncClient, db_session: AsyncSession) -> None:
    headers_a, site_a, _, _ = await _org_with_two_assets(db_session, org_name="Org A", email="a@example.com")
    headers_b, _site_b, _, _ = await _org_with_two_assets(db_session, org_name="Org B", email="b@example.com")

    cross = await client.get("/api/topology", headers=headers_b, params={"site_id": str(site_a)})
    assert cross.status_code == 404
