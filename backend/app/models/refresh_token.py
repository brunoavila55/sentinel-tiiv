import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import CreatedAtMixin, UUIDPrimaryKeyMixin


class RefreshToken(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """Sessão de refresh. Permite logout real (revogação) e rotação a cada uso.

    O access token é um JWT stateless de vida curta e não tem uma linha
    correspondente aqui — não pode ser revogado antes de expirar, e essa é
    uma troca deliberada (ver README) para não precisar consultar o banco
    a cada requisição autenticada.
    """

    __tablename__ = "refresh_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Nunca o token puro: só o hash (mesmo padrão de organization_invites).
    token_hash: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
