import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.asset import Asset
    from app.models.organization import Organization


class Site(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "sites"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)

    organization: Mapped["Organization"] = relationship(back_populates="sites")
    # RESTRICT (ver Asset.site_id): um site com ativos não pode ser
    # removido silenciosamente pelo banco.
    assets: Mapped[list["Asset"]] = relationship(back_populates="site")
