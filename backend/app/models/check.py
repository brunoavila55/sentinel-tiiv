import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.asset import Asset
    from app.models.check_result import CheckResult


class Check(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "checks"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # String livre (não enum de banco): o único tipo suportado hoje é
    # "ping", mas o modelo precisa aceitar tipos futuros (http, tcp, dns,
    # snmp, agente) sem exigir uma migration a cada novo tipo.
    type: Mapped[str] = mapped_column(String(50), nullable=False, default="ping", server_default="ping")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    interval_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=30, server_default="30")
    timeout_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    next_check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    last_check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Contadores da máquina de estados (Prompt 10). Vivem no check, não no
    # ativo: um ativo pode ter mais de um check no futuro, cada um com seu
    # próprio histórico de sucessos/falhas consecutivos.
    consecutive_successes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    consecutive_failures: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    asset: Mapped["Asset"] = relationship(back_populates="checks")
    results: Mapped[list["CheckResult"]] = relationship(back_populates="check", cascade="all, delete-orphan")
