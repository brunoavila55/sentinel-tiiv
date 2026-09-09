import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import CreatedAtMixin
from app.models.enums import OrganizationRole

if TYPE_CHECKING:
    from app.models.organization import Organization
    from app.models.user import User

organization_role_enum = PGEnum(
    OrganizationRole, name="organization_role", values_callable=lambda e: [i.value for i in e]
)


class OrganizationUser(CreatedAtMixin, Base):
    """Associação usuário <-> organização. Um usuário pode ter uma role por organização."""

    __tablename__ = "organization_users"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[OrganizationRole] = mapped_column(organization_role_enum, nullable=False)

    organization: Mapped["Organization"] = relationship(back_populates="memberships")
    user: Mapped["User"] = relationship(back_populates="memberships")
