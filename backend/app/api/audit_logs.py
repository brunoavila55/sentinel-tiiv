from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import ROLES_MANAGE_USERS, require_role
from app.core.database import get_db
from app.models.audit_log import AuditLog
from app.models.organization_user import OrganizationUser
from app.schemas.audit_log import AuditLogOut
from app.services import audit_service

router = APIRouter(prefix="/audit-logs", tags=["audit-logs"])


def _audit_log_out(entry: AuditLog) -> AuditLogOut:
    return AuditLogOut(
        id=entry.id,
        user_id=entry.user_id,
        user_name=entry.user.name if entry.user is not None else None,
        action=entry.action,
        entity_type=entry.entity_type,
        entity_id=entry.entity_id,
        metadata=entry.event_metadata,
        created_at=entry.created_at,
    )


@router.get("", response_model=list[AuditLogOut])
async def list_audit_logs(
    limit: int = Query(default=100, ge=1, le=500),
    # Só owner/admin: auditoria é uma trilha administrativa, não dado
    # operacional que operator/viewer precisem ver.
    membership: OrganizationUser = Depends(require_role(*ROLES_MANAGE_USERS)),
    db: AsyncSession = Depends(get_db),
) -> list[AuditLogOut]:
    entries = await audit_service.list_recent(db, membership.organization_id, limit=limit)
    return [_audit_log_out(e) for e in entries]
