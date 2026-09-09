import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import AssetStatus
from app.repositories import asset_repository, dashboard_repository
from app.schemas.dashboard import (
    DashboardActivityEntry,
    DashboardProblem,
    DashboardResponse,
    DashboardSiteHealth,
    DashboardTotals,
)

RECENT_ACTIVITY_LIMIT = 10
DASHBOARD_PROBLEMS_LIMIT = 5


async def get_dashboard(db: AsyncSession, organization_id: uuid.UUID) -> DashboardResponse:
    counts = await dashboard_repository.count_assets_by_status(db, organization_id)
    totals = DashboardTotals(
        total=sum(counts.values()),
        up=counts.get(AssetStatus.UP, 0),
        warning=counts.get(AssetStatus.WARNING, 0),
        down=counts.get(AssetStatus.DOWN, 0),
        unknown=counts.get(AssetStatus.UNKNOWN, 0),
    )

    site_rows = await dashboard_repository.site_health(db, organization_id)
    sites = [
        DashboardSiteHealth(
            site_id=site_id,
            site_name=site_name,
            total_assets=total,
            up_percentage=round((up / total) * 100, 1) if total else None,
        )
        for site_id, site_name, total, up in site_rows
    ]

    problem_rows = await asset_repository.list_problems(db, organization_id)
    problems = [
        DashboardProblem(
            asset_id=asset.id, asset_name=asset.name, site_name=site_name, status=asset.status,
            status_since=asset.status_since,
        )
        for asset, site_name, _message in problem_rows[:DASHBOARD_PROBLEMS_LIMIT]
    ]

    activity_rows = await dashboard_repository.recent_activity(db, organization_id, RECENT_ACTIVITY_LIMIT)
    recent_activity = [
        DashboardActivityEntry(
            asset_id=row.asset_id, asset_name=row.asset_name, status=row.status, checked_at=row.checked_at
        )
        for row in activity_rows
    ]

    return DashboardResponse(totals=totals, sites=sites, problems=problems, recent_activity=recent_activity)
