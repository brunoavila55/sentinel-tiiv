import uuid

from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import AssetStatus
from app.repositories import asset_repository


async def list_problems(
    db: AsyncSession,
    organization_id: uuid.UUID,
    *,
    site_id: uuid.UUID | None = None,
    status: AssetStatus | None = None,
    search: str | None = None,
) -> list[Row]:
    return list(
        await asset_repository.list_problems(db, organization_id, site_id=site_id, status=status, search=search)
    )
