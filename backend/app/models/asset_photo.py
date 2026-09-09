import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import CreatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.asset import Asset


class AssetPhoto(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "asset_photos"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Chave do objeto no MinIO (organizations/{org}/assets/{asset}/{uuid}.ext).
    storage_key: Mapped[str] = mapped_column(String(1000), nullable=False, unique=True)
    # Miniatura pré-gerada no upload, para as listagens não baixarem a
    # imagem original. Mesmo bucket privado, mesma política de URL assinada.
    thumbnail_storage_key: Mapped[str | None] = mapped_column(String(1000), nullable=True, unique=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    caption: Mapped[str | None] = mapped_column(String(500), nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    asset: Mapped["Asset"] = relationship(back_populates="photos")
