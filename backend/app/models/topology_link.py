import uuid

from sqlalchemy import CheckConstraint, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import CreatedAtMixin, UUIDPrimaryKeyMixin


class TopologyLink(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """Aresta de um grafo (não uma árvore): por isso source/target, não parent_id."""

    __tablename__ = "topology_links"
    __table_args__ = (
        CheckConstraint("source_asset_id <> target_asset_id", name="ck_topology_links_no_self_link"),
        UniqueConstraint("source_asset_id", "target_asset_id", name="uq_topology_links_source_target"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_asset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    target_asset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    link_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="connection", server_default="connection"
    )
