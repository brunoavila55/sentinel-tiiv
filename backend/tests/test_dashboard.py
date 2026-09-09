from datetime import datetime, timezone

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models.asset import Asset
from app.models.check import Check
from app.models.check_result import CheckResult
from app.models.enums import AssetStatus, OrganizationRole
from app.models.site import Site
from tests.factories import create_org_member


async def test_dashboard_on_empty_organization(client: AsyncClient, db_session: AsyncSession) -> None:
    member = await create_org_member(db_session, org_name="Org Vazia", email="owner@example.com", role=OrganizationRole.OWNER)
    token, _ = create_access_token(member.user.id)
    headers = {"Authorization": f"Bearer {token}", "X-Organization-Id": str(member.organization.id)}

    response = await client.get("/api/dashboard", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["totals"] == {"total": 0, "up": 0, "warning": 0, "down": 0, "unknown": 0}
    assert body["sites"] == []
    assert body["problems"] == []
    assert body["recent_activity"] == []


async def test_dashboard_aggregates_totals_sites_problems_and_activity(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    member = await create_org_member(db_session, org_name="Org", email="owner@example.com", role=OrganizationRole.OWNER)
    token, _ = create_access_token(member.user.id)
    headers = {"Authorization": f"Bearer {token}", "X-Organization-Id": str(member.organization.id)}
    org_id = member.organization.id

    site_with_assets = Site(organization_id=org_id, name="Matriz")
    empty_site = Site(organization_id=org_id, name="Filial vazia")
    db_session.add_all([site_with_assets, empty_site])
    await db_session.flush()

    up_asset = Asset(organization_id=org_id, site_id=site_with_assets.id, name="up-1", ip_address="10.0.0.1", status=AssetStatus.UP)
    down_asset = Asset(
        organization_id=org_id,
        site_id=site_with_assets.id,
        name="down-1",
        ip_address="10.0.0.2",
        status=AssetStatus.DOWN,
        status_since=datetime.now(timezone.utc),
    )
    db_session.add_all([up_asset, down_asset])
    await db_session.flush()

    check = Check(organization_id=org_id, asset_id=up_asset.id, type="ping")
    db_session.add(check)
    await db_session.flush()
    db_session.add(
        CheckResult(
            organization_id=org_id,
            check_id=check.id,
            asset_id=up_asset.id,
            status=AssetStatus.UP,
            latency_ms=1.2,
            packet_loss=0.0,
            checked_at=datetime.now(timezone.utc),
        )
    )
    await db_session.commit()

    response = await client.get("/api/dashboard", headers=headers)
    assert response.status_code == 200
    body = response.json()

    assert body["totals"] == {"total": 2, "up": 1, "warning": 0, "down": 1, "unknown": 0}

    sites_by_name = {s["site_name"]: s for s in body["sites"]}
    assert sites_by_name["Matriz"]["total_assets"] == 2
    assert sites_by_name["Matriz"]["up_percentage"] == 50.0
    assert sites_by_name["Filial vazia"]["total_assets"] == 0
    assert sites_by_name["Filial vazia"]["up_percentage"] is None

    assert len(body["problems"]) == 1
    assert body["problems"][0]["asset_name"] == "down-1"

    assert len(body["recent_activity"]) == 1
    assert body["recent_activity"][0]["asset_name"] == "up-1"


async def test_dashboard_isolated_between_organizations(client: AsyncClient, db_session: AsyncSession) -> None:
    member_a = await create_org_member(db_session, org_name="Org A", email="a@example.com", role=OrganizationRole.OWNER)
    member_b = await create_org_member(db_session, org_name="Org B", email="b@example.com", role=OrganizationRole.OWNER)

    site = Site(organization_id=member_a.organization.id, name="Matriz")
    db_session.add(site)
    await db_session.flush()
    db_session.add(Asset(organization_id=member_a.organization.id, site_id=site.id, name="a", ip_address="10.0.0.1"))
    await db_session.commit()

    token_b, _ = create_access_token(member_b.user.id)
    headers_b = {"Authorization": f"Bearer {token_b}", "X-Organization-Id": str(member_b.organization.id)}

    response = await client.get("/api/dashboard", headers=headers_b)
    assert response.status_code == 200
    assert response.json()["totals"]["total"] == 0
