from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.core.slug import slugify
from app.models.enums import OrganizationRole
from app.models.organization import Organization
from app.models.organization_user import OrganizationUser
from app.models.user import User


@dataclass
class OrgMember:
    organization: Organization
    user: User
    membership: OrganizationUser


async def create_org_member(
    db: AsyncSession,
    *,
    org_name: str = "Empresa",
    email: str = "user@example.com",
    password: str = "senha12345",
    role: OrganizationRole = OrganizationRole.OWNER,
) -> OrgMember:
    organization = Organization(name=org_name, slug=slugify(org_name) + "-" + email.split("@")[0])
    user = User(name=email.split("@")[0], email=email, password_hash=hash_password(password))
    db.add_all([organization, user])
    await db.flush()

    membership = OrganizationUser(organization_id=organization.id, user_id=user.id, role=role)
    db.add(membership)
    await db.commit()

    return OrgMember(organization=organization, user=user, membership=membership)
