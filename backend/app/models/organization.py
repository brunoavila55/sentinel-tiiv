from typing import TYPE_CHECKING

from sqlalchemy import String
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import OrganizationStatus

if TYPE_CHECKING:
    from app.models.organization_user import OrganizationUser
    from app.models.site import Site

organization_status_enum = PGEnum(
    OrganizationStatus, name="organization_status", values_callable=lambda e: [i.value for i in e]
)


class Organization(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    # Plano fica como string livre de propósito: os limites de cada plano
    # são resolvidos pelo EntitlementService (etapa futura), não pelo schema.
    plan: Mapped[str] = mapped_column(String(50), nullable=False, default="free", server_default="free")
    status: Mapped[OrganizationStatus] = mapped_column(
        organization_status_enum,
        nullable=False,
        default=OrganizationStatus.ACTIVE,
        server_default=OrganizationStatus.ACTIVE.value,
    )

    memberships: Mapped[list["OrganizationUser"]] = relationship(
        back_populates="organization", cascade="all, delete-orphan"
    )
    sites: Mapped[list["Site"]] = relationship(back_populates="organization", cascade="all, delete-orphan")
