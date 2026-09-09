import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import contains_eager, selectinload

from app.models.enums import OrganizationRole
from app.models.organization import Organization
from app.models.organization_user import OrganizationUser
from app.models.user import User


async def get_by_id(db: AsyncSession, organization_id: uuid.UUID) -> Organization | None:
    return await db.get(Organization, organization_id)


async def slug_exists(db: AsyncSession, slug: str) -> bool:
    result = await db.execute(select(Organization.id).where(Organization.slug == slug))
    return result.scalar_one_or_none() is not None


async def get_membership(
    db: AsyncSession, organization_id: uuid.UUID, user_id: uuid.UUID
) -> OrganizationUser | None:
    result = await db.execute(
        select(OrganizationUser)
        .where(
            OrganizationUser.organization_id == organization_id,
            OrganizationUser.user_id == user_id,
        )
        .options(selectinload(OrganizationUser.organization))
    )
    return result.scalar_one_or_none()


async def list_memberships_for_user(db: AsyncSession, user_id: uuid.UUID) -> list[OrganizationUser]:
    result = await db.execute(
        select(OrganizationUser)
        .where(OrganizationUser.user_id == user_id)
        .options(selectinload(OrganizationUser.organization))
    )
    return list(result.scalars().all())


async def list_members(
    db: AsyncSession,
    organization_id: uuid.UUID,
    *,
    search: str | None = None,
    role: OrganizationRole | None = None,
) -> list[OrganizationUser]:
    stmt = (
        select(OrganizationUser)
        .join(User, OrganizationUser.user_id == User.id)
        .where(OrganizationUser.organization_id == organization_id)
        .options(contains_eager(OrganizationUser.user))
        .order_by(User.name)
    )
    if role is not None:
        stmt = stmt.where(OrganizationUser.role == role)
    if search:
        pattern = f"%{search.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(User.name).like(pattern), func.lower(User.email).like(pattern)))

    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_member_by_user_id(
    db: AsyncSession, organization_id: uuid.UUID, user_id: uuid.UUID
) -> OrganizationUser | None:
    result = await db.execute(
        select(OrganizationUser)
        .where(
            OrganizationUser.organization_id == organization_id,
            OrganizationUser.user_id == user_id,
        )
        .options(selectinload(OrganizationUser.user))
    )
    return result.scalar_one_or_none()


async def count_owners(db: AsyncSession, organization_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(OrganizationUser)
        .where(
            OrganizationUser.organization_id == organization_id,
            OrganizationUser.role == OrganizationRole.OWNER,
        )
    )
    return result.scalar_one()


async def count_members(db: AsyncSession, organization_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.count()).select_from(OrganizationUser).where(OrganizationUser.organization_id == organization_id)
    )
    return result.scalar_one()
