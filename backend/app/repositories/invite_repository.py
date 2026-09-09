import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.organization_invite import OrganizationInvite


async def create(db: AsyncSession, **fields: object) -> OrganizationInvite:
    invite = OrganizationInvite(**fields)
    db.add(invite)
    await db.flush()
    return invite


async def get_pending_by_email(
    db: AsyncSession, organization_id: uuid.UUID, email: str
) -> OrganizationInvite | None:
    result = await db.execute(
        select(OrganizationInvite).where(
            OrganizationInvite.organization_id == organization_id,
            OrganizationInvite.email == email,
            OrganizationInvite.accepted_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def list_pending(db: AsyncSession, organization_id: uuid.UUID) -> list[OrganizationInvite]:
    result = await db.execute(
        select(OrganizationInvite)
        .where(
            OrganizationInvite.organization_id == organization_id,
            OrganizationInvite.accepted_at.is_(None),
        )
        .order_by(OrganizationInvite.created_at.desc())
    )
    return list(result.scalars().all())


async def get_by_id(
    db: AsyncSession, organization_id: uuid.UUID, invite_id: uuid.UUID
) -> OrganizationInvite | None:
    result = await db.execute(
        select(OrganizationInvite).where(
            OrganizationInvite.id == invite_id,
            OrganizationInvite.organization_id == organization_id,
        )
    )
    return result.scalar_one_or_none()


async def get_valid_by_token_hash(db: AsyncSession, token_hash: str) -> OrganizationInvite | None:
    result = await db.execute(select(OrganizationInvite).where(OrganizationInvite.token_hash == token_hash))
    invite = result.scalar_one_or_none()
    if invite is None or invite.accepted_at is not None:
        return None
    if invite.expires_at < datetime.now(timezone.utc):
        return None
    return invite


async def delete(db: AsyncSession, invite: OrganizationInvite) -> None:
    await db.delete(invite)
