import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.check import Check


async def list_for_asset(db: AsyncSession, organization_id: uuid.UUID, asset_id: uuid.UUID) -> list[Check]:
    result = await db.execute(
        select(Check)
        .where(Check.organization_id == organization_id, Check.asset_id == asset_id)
        .order_by(Check.created_at)
    )
    return list(result.scalars().all())


async def get_by_id(
    db: AsyncSession, organization_id: uuid.UUID, asset_id: uuid.UUID, check_id: uuid.UUID
) -> Check | None:
    result = await db.execute(
        select(Check).where(
            Check.id == check_id,
            Check.organization_id == organization_id,
            Check.asset_id == asset_id,
        )
    )
    return result.scalar_one_or_none()


async def create(db: AsyncSession, **fields: object) -> Check:
    check = Check(**fields)
    db.add(check)
    await db.flush()
    return check


async def delete(db: AsyncSession, check: Check) -> None:
    await db.delete(check)
