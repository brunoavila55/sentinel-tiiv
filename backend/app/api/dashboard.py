from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_membership
from app.models.organization_user import OrganizationUser
from app.schemas.dashboard import DashboardResponse
from app.services import dashboard_service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardResponse)
async def get_dashboard(
    membership: OrganizationUser = Depends(get_current_membership),
    db: AsyncSession = Depends(get_db),
) -> DashboardResponse:
    return await dashboard_service.get_dashboard(db, membership.organization_id)
