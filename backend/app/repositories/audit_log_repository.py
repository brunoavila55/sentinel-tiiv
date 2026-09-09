import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.audit_log import AuditLog


async def create(db: AsyncSession, **fields: object) -> AuditLog:
    entry = AuditLog(**fields)
    db.add(entry)
    await db.flush()
    return entry


async def list_recent(db: AsyncSession, organization_id: uuid.UUID, *, limit: int = 100) -> Sequence[AuditLog]:
    result = await db.execute(
        select(AuditLog)
        .where(AuditLog.organization_id == organization_id)
        .options(selectinload(AuditLog.user))
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
    )
    return result.scalars().all()
