import uuid
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.check_result import CheckResult
from app.repositories import asset_repository, check_result_repository

MAX_LIMIT = 500
DEFAULT_LIMIT = 100


async def get_history(
    db: AsyncSession,
    organization_id: uuid.UUID,
    asset_id: uuid.UUID,
    *,
    since: datetime | None,
    until: datetime | None,
    limit: int,
) -> list[CheckResult]:
    asset = await asset_repository.get_model(db, organization_id, asset_id)
    if asset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ativo não encontrado")

    limit = max(1, min(limit, MAX_LIMIT))
    return await check_result_repository.list_for_asset(db, organization_id, asset_id, since=since, until=until, limit=limit)
