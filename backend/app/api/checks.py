import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import ROLES_WRITE_OPERATIONAL, require_role
from app.core.database import get_db
from app.core.dependencies import get_current_membership
from app.models.check import Check
from app.models.organization_user import OrganizationUser
from app.schemas.check import CheckCreateRequest, CheckOut, CheckUpdateRequest
from app.services import check_service

router = APIRouter(prefix="/assets/{asset_id}/checks", tags=["checks"])


def _check_out(check: Check) -> CheckOut:
    config = check.config if isinstance(check.config, dict) else {}
    return CheckOut(
        id=check.id,
        asset_id=check.asset_id,
        type=check.type,
        enabled=check.enabled,
        interval_seconds=check.interval_seconds,
        timeout_seconds=check.timeout_seconds,
        packets=config.get("packets", 3),
        next_check_at=check.next_check_at,
        last_check_at=check.last_check_at,
        consecutive_successes=check.consecutive_successes,
        consecutive_failures=check.consecutive_failures,
        created_at=check.created_at,
        updated_at=check.updated_at,
    )


@router.get("", response_model=list[CheckOut])
async def list_checks(
    asset_id: uuid.UUID,
    membership: OrganizationUser = Depends(get_current_membership),
    db: AsyncSession = Depends(get_db),
) -> list[CheckOut]:
    checks = await check_service.list_checks(db, membership.organization_id, asset_id)
    return [_check_out(c) for c in checks]


@router.post("", response_model=CheckOut, status_code=status.HTTP_201_CREATED)
async def create_check(
    asset_id: uuid.UUID,
    payload: CheckCreateRequest,
    membership: OrganizationUser = Depends(require_role(*ROLES_WRITE_OPERATIONAL)),
    db: AsyncSession = Depends(get_db),
) -> CheckOut:
    check = await check_service.create_check(db, membership.organization_id, asset_id, payload, membership.user_id)
    return _check_out(check)


@router.patch("/{check_id}", response_model=CheckOut)
async def update_check(
    asset_id: uuid.UUID,
    check_id: uuid.UUID,
    payload: CheckUpdateRequest,
    membership: OrganizationUser = Depends(require_role(*ROLES_WRITE_OPERATIONAL)),
    db: AsyncSession = Depends(get_db),
) -> CheckOut:
    check = await check_service.update_check(
        db, membership.organization_id, asset_id, check_id, payload, membership.user_id
    )
    return _check_out(check)


@router.delete("/{check_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_check(
    asset_id: uuid.UUID,
    check_id: uuid.UUID,
    membership: OrganizationUser = Depends(require_role(*ROLES_WRITE_OPERATIONAL)),
    db: AsyncSession = Depends(get_db),
) -> None:
    await check_service.delete_check(db, membership.organization_id, asset_id, check_id, membership.user_id)
