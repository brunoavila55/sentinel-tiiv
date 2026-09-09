import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Float, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.asset import asset_status_enum
from app.models.base import UUIDPrimaryKeyMixin
from app.models.enums import AssetStatus

if TYPE_CHECKING:
    from app.models.check import Check


class CheckResult(UUIDPrimaryKeyMixin, Base):
    """Tabela append-only: cada linha é uma execução de check no passado."""

    __tablename__ = "check_results"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    check_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("checks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[AssetStatus] = mapped_column(asset_status_enum, nullable=False, index=True)
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    packet_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Mensagem normalizada (ex.: "sem resposta ICMP"), nunca a exceção
    # Python bruta.
    message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    checked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )

    check: Mapped["Check"] = relationship(back_populates="results")
