from typing import TYPE_CHECKING

from sqlalchemy import String
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import UserStatus

if TYPE_CHECKING:
    from app.models.organization_user import OrganizationUser

user_status_enum = PGEnum(
    UserStatus, name="user_status", values_callable=lambda e: [i.value for i in e]
)


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Único globalmente: um email pertence a exatamente um usuário,
    # independentemente de quantas organizations ele participa.
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[UserStatus] = mapped_column(
        user_status_enum, nullable=False, default=UserStatus.ACTIVE, server_default=UserStatus.ACTIVE.value
    )

    memberships: Mapped[list["OrganizationUser"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
