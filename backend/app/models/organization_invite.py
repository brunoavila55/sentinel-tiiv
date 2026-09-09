import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import CreatedAtMixin, UUIDPrimaryKeyMixin
from app.models.enums import OrganizationRole
from app.models.organization_user import organization_role_enum


class OrganizationInvite(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "organization_invites"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    role: Mapped[OrganizationRole] = mapped_column(organization_role_enum, nullable=False)
    # Nunca armazenar o token puro: só o hash. O token em si é entregue
    # uma única vez (link de convite) e não pode ser recuperado depois.
    token_hash: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
