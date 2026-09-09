import uuid
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.refresh_token import RefreshToken


async def create(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    token_hash: str,
    expires_at: datetime,
    user_agent: str | None,
    ip_address: str | None,
) -> RefreshToken:
    token = RefreshToken(
        user_id=user_id,
        token_hash=token_hash,
        expires_at=expires_at,
        user_agent=user_agent,
        ip_address=ip_address,
    )
    db.add(token)
    await db.flush()
    return token


async def get_valid_by_hash(db: AsyncSession, token_hash: str) -> RefreshToken | None:
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    token = result.scalar_one_or_none()
    if token is None:
        return None
    if token.revoked_at is not None:
        return None
    if token.expires_at < datetime.now(timezone.utc):
        return None
    return token


async def revoke(db: AsyncSession, token: RefreshToken) -> None:
    token.revoked_at = datetime.now(timezone.utc)


async def revoke_all_for_user(db: AsyncSession, user_id: uuid.UUID) -> None:
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )
