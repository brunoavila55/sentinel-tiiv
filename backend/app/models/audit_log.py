import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import CreatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.user import User


class AuditLog(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "audit_logs"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # SET NULL: o log de auditoria sobrevive à remoção do usuário que o gerou.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    # "metadata" é reservado em Base (Base.metadata); mapeado com outro nome
    # de atributo Python, mas a coluna no banco continua se chamando metadata.
    event_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)

    user: Mapped["User | None"] = relationship()
