import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import INET, UUID
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import AssetStatus

if TYPE_CHECKING:
    from app.models.asset_photo import AssetPhoto
    from app.models.check import Check
    from app.models.site import Site

asset_status_enum = PGEnum(
    AssetStatus, name="asset_status", values_callable=lambda e: [i.value for i in e]
)


class Asset(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "assets"
    __table_args__ = (
        CheckConstraint("hostname IS NOT NULL OR ip_address IS NOT NULL", name="ck_assets_hostname_or_ip"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # RESTRICT: impede que um site seja removido enquanto tiver ativos.
    # A remoção deve ser uma decisão explícita na camada de negócio, não
    # um efeito colateral silencioso de um DELETE em sites.
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    hostname: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(INET, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    status: Mapped[AssetStatus] = mapped_column(
        asset_status_enum,
        nullable=False,
        default=AssetStatus.UNKNOWN,
        server_default=AssetStatus.UNKNOWN.value,
        index=True,
    )
    last_rtt_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    packet_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Quando o status atual começou (o worker só atualiza isto quando o
    # status realmente muda) — usado pela tela de Problemas pra mostrar
    # "há quanto tempo" e ordenar DOWN mais antigo primeiro.
    status_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    site: Mapped["Site"] = relationship(back_populates="assets")
    checks: Mapped[list["Check"]] = relationship(back_populates="asset", cascade="all, delete-orphan")
    photos: Mapped[list["AssetPhoto"]] = relationship(
        back_populates="asset", cascade="all, delete-orphan", order_by="AssetPhoto.position"
    )
