import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset_photo import AssetPhoto


async def list_for_asset(
    db: AsyncSession, organization_id: uuid.UUID, asset_id: uuid.UUID, category: str
) -> list[AssetPhoto]:
    result = await db.execute(
        select(AssetPhoto)
        .where(
            AssetPhoto.organization_id == organization_id,
            AssetPhoto.asset_id == asset_id,
            AssetPhoto.category == category,
        )
        .order_by(AssetPhoto.position)
    )
    return list(result.scalars().all())


async def get_by_id(
    db: AsyncSession, organization_id: uuid.UUID, asset_id: uuid.UUID, photo_id: uuid.UUID
) -> AssetPhoto | None:
    result = await db.execute(
        select(AssetPhoto).where(
            AssetPhoto.id == photo_id,
            AssetPhoto.organization_id == organization_id,
            AssetPhoto.asset_id == asset_id,
        )
    )
    return result.scalar_one_or_none()


async def next_position(db: AsyncSession, asset_id: uuid.UUID, category: str) -> int:
    result = await db.execute(
        select(func.max(AssetPhoto.position)).where(
            AssetPhoto.asset_id == asset_id, AssetPhoto.category == category
        )
    )
    current_max = result.scalar_one()
    return 0 if current_max is None else current_max + 1


async def create(db: AsyncSession, **fields: object) -> AssetPhoto:
    photo = AssetPhoto(**fields)
    db.add(photo)
    await db.flush()
    return photo


async def delete(db: AsyncSession, photo: AssetPhoto) -> None:
    await db.delete(photo)


async def sum_storage_bytes(db: AsyncSession, organization_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.coalesce(func.sum(AssetPhoto.size_bytes), 0)).where(
            AssetPhoto.organization_id == organization_id
        )
    )
    return result.scalar_one()
