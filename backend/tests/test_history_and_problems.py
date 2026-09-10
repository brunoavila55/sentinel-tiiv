import uuid
from datetime import datetime, timedelta, timezone

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models.asset import Asset
from app.models.check import Check
from app.models.check_result import CheckResult
from app.models.enums import AssetStatus, OrganizationRole
from app.models.site import Site
from tests.factories import create_org_member


async def _org_with_asset(db_session: AsyncSession, *, org_name: str, email: str) -> tuple[dict, Asset]:
    member = await create_org_member(db_session, org_name=org_name, email=email, role=OrganizationRole.OWNER)
    token, _ = create_access_token(member.user.id)
    headers = {"Authorization": f"Bearer {token}", "X-Organization-Id": str(member.organization.id)}

    site = Site(organization_id=member.organization.id, name="Matriz")
    db_session.add(site)
    await db_session.flush()
    asset = Asset(organization_id=member.organization.id, site_id=site.id, name="sw-core", ip_address="10.0.0.1")
    db_session.add(asset)
    await db_session.commit()
    await db_session.refresh(asset)
    return headers, asset


async def _add_check_result(
    db_session: AsyncSession, asset: Asset, check: Check, *, status: AssetStatus, checked_at: datetime, latency_ms=1.0
) -> None:
    db_session.add(
        CheckResult(
            organization_id=asset.organization_id,
            check_id=check.id,
            asset_id=asset.id,
            status=status,
            latency_ms=latency_ms,
            packet_loss=0.0,
            checked_at=checked_at,
        )
    )
    await db_session.commit()


async def _make_check(db_session: AsyncSession, asset: Asset) -> Check:
    check = Check(organization_id=asset.organization_id, asset_id=asset.id, type="ping")
    db_session.add(check)
    await db_session.commit()
    await db_session.refresh(check)
    return check


async def test_history_returns_results_ordered_newest_first(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, asset = await _org_with_asset(db_session, org_name="Org", email="owner@example.com")
    check = await _make_check(db_session, asset)

    now = datetime.now(timezone.utc)
    await _add_check_result(db_session, asset, check, status=AssetStatus.UP, checked_at=now - timedelta(minutes=10))
    await _add_check_result(db_session, asset, check, status=AssetStatus.DOWN, checked_at=now - timedelta(minutes=5))
    await _add_check_result(db_session, asset, check, status=AssetStatus.UP, checked_at=now)

    response = await client.get(f"/api/assets/{asset.id}/history", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 3
    assert body[0]["status"] == "up"  # mais recente primeiro
    assert body[2]["status"] == "up"  # mais antigo por último


async def test_history_only_lists_status_transitions(client: AsyncClient, db_session: AsyncSession) -> None:
    """Histórico mostra só quedas e retornos (transições de status), não
    cada ping de rotina — dois checks UP seguidos não geram duas linhas."""
    headers, asset = await _org_with_asset(db_session, org_name="Org", email="owner@example.com")
    check = await _make_check(db_session, asset)

    now = datetime.now(timezone.utc)
    # down (120), up (60), down (30), up (10), up (1) — o último "up" é
    # continuação do anterior, não uma transição nova.
    await _add_check_result(db_session, asset, check, status=AssetStatus.DOWN, checked_at=now - timedelta(minutes=120))
    await _add_check_result(db_session, asset, check, status=AssetStatus.UP, checked_at=now - timedelta(minutes=60))
    await _add_check_result(db_session, asset, check, status=AssetStatus.DOWN, checked_at=now - timedelta(minutes=30))
    await _add_check_result(db_session, asset, check, status=AssetStatus.UP, checked_at=now - timedelta(minutes=10))
    await _add_check_result(db_session, asset, check, status=AssetStatus.UP, checked_at=now - timedelta(minutes=1))

    full = await client.get(f"/api/assets/{asset.id}/history", headers=headers)
    assert full.status_code == 200
    assert len(full.json()) == 4  # as 5 checagens viram 4 transições

    since = (now - timedelta(minutes=35)).isoformat()
    response = await client.get(f"/api/assets/{asset.id}/history", headers=headers, params={"from": since})
    assert response.status_code == 200
    # dentro da janela: down (30) e up (10) são transições; up (1) não é
    assert len(response.json()) == 2

    limited = await client.get(f"/api/assets/{asset.id}/history?limit=1", headers=headers)
    assert len(limited.json()) == 1
    assert limited.json()[0]["status"] == "up"  # transição mais recente (10 min atrás)


async def test_history_isolated_between_organizations(client: AsyncClient, db_session: AsyncSession) -> None:
    headers_a, asset_a = await _org_with_asset(db_session, org_name="Org A", email="a@example.com")
    headers_b, _asset_b = await _org_with_asset(db_session, org_name="Org B", email="b@example.com")

    response = await client.get(f"/api/assets/{asset_a.id}/history", headers=headers_b)
    assert response.status_code == 404


async def test_problems_lists_only_warning_and_down_sorted(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, _ = await _org_with_asset(db_session, org_name="Org", email="owner@example.com")
    org_id = uuid.UUID(headers["X-Organization-Id"])

    site = (await db_session.execute(select(Site).where(Site.organization_id == org_id))).scalar_one()

    now = datetime.now(timezone.utc)

    up_asset = Asset(
        organization_id=org_id, site_id=site.id, name="up-asset", ip_address="10.0.0.2", status=AssetStatus.UP
    )
    down_old = Asset(
        organization_id=org_id,
        site_id=site.id,
        name="down-old",
        ip_address="10.0.0.3",
        status=AssetStatus.DOWN,
        status_since=now - timedelta(hours=2),
    )
    down_recent = Asset(
        organization_id=org_id,
        site_id=site.id,
        name="down-recent",
        ip_address="10.0.0.4",
        status=AssetStatus.DOWN,
        status_since=now - timedelta(minutes=5),
    )
    warning_asset = Asset(
        organization_id=org_id,
        site_id=site.id,
        name="warning-asset",
        ip_address="10.0.0.5",
        status=AssetStatus.WARNING,
        status_since=now - timedelta(minutes=1),
    )
    db_session.add_all([up_asset, down_old, down_recent, warning_asset])
    await db_session.commit()

    response = await client.get("/api/problems", headers=headers)
    assert response.status_code == 200
    names = [p["asset_name"] for p in response.json()]
    # up-asset nunca aparece; down mais antigo primeiro, depois down mais
    # recente, depois warning.
    assert names == ["down-old", "down-recent", "warning-asset"]


async def test_problems_isolated_between_organizations(client: AsyncClient, db_session: AsyncSession) -> None:
    headers_a, asset_a = await _org_with_asset(db_session, org_name="Org A", email="a@example.com")
    headers_b, _ = await _org_with_asset(db_session, org_name="Org B", email="b@example.com")

    asset_a.status = AssetStatus.DOWN
    asset_a.status_since = datetime.now(timezone.utc)
    await db_session.commit()

    response_a = await client.get("/api/problems", headers=headers_a)
    assert len(response_a.json()) == 1

    response_b = await client.get("/api/problems", headers=headers_b)
    assert response_b.json() == []


async def test_problems_shows_latest_check_result_message(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, asset = await _org_with_asset(db_session, org_name="Org", email="owner@example.com")
    check = await _make_check(db_session, asset)

    now = datetime.now(timezone.utc)
    await _add_check_result(db_session, asset, check, status=AssetStatus.DOWN, checked_at=now - timedelta(minutes=5))
    db_session.add(
        CheckResult(
            organization_id=asset.organization_id,
            check_id=check.id,
            asset_id=asset.id,
            status=AssetStatus.DOWN,
            message="Sem resposta ICMP",
            checked_at=now,
        )
    )
    asset.status = AssetStatus.DOWN
    asset.status_since = now - timedelta(minutes=5)
    await db_session.commit()

    response = await client.get("/api/problems", headers=headers)
    assert response.json()[0]["message"] == "Sem resposta ICMP"


async def test_problems_filters_by_site_status_and_search(client: AsyncClient, db_session: AsyncSession) -> None:
    headers, _ = await _org_with_asset(db_session, org_name="Org", email="owner@example.com")
    org_id = uuid.UUID(headers["X-Organization-Id"])
    site = (await db_session.execute(select(Site).where(Site.organization_id == org_id))).scalar_one()

    other_site = Site(organization_id=org_id, name="Filial")
    db_session.add(other_site)
    await db_session.flush()

    now = datetime.now(timezone.utc)
    down_matriz = Asset(
        organization_id=org_id,
        site_id=site.id,
        name="srv-db-02",
        ip_address="10.20.1.17",
        status=AssetStatus.DOWN,
        status_since=now,
    )
    warning_filial = Asset(
        organization_id=org_id,
        site_id=other_site.id,
        name="ap-recepcao",
        ip_address="10.20.1.18",
        status=AssetStatus.WARNING,
        status_since=now,
    )
    db_session.add_all([down_matriz, warning_filial])
    await db_session.commit()

    by_site = await client.get("/api/problems", headers=headers, params={"site_id": str(site.id)})
    assert [p["asset_name"] for p in by_site.json()] == ["srv-db-02"]

    by_status = await client.get("/api/problems", headers=headers, params={"status": "warning"})
    assert [p["asset_name"] for p in by_status.json()] == ["ap-recepcao"]

    # status fora de warning/down é ignorado, não devolve ativo saudável.
    ignored_status = await client.get("/api/problems", headers=headers, params={"status": "up"})
    names = {p["asset_name"] for p in ignored_status.json()}
    assert names == {"srv-db-02", "ap-recepcao"}

    by_search = await client.get("/api/problems", headers=headers, params={"search": "srv-db"})
    assert [p["asset_name"] for p in by_search.json()] == ["srv-db-02"]
