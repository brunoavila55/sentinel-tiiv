import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.models.enums import OrganizationRole, OrganizationStatus, UserStatus


class OrganizationOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    plan: str
    status: OrganizationStatus
    created_at: datetime

    model_config = {"from_attributes": True}


class OrganizationUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class MemberOut(BaseModel):
    user_id: uuid.UUID
    name: str
    email: str
    role: OrganizationRole
    status: UserStatus
    member_since: datetime


class MemberRoleUpdateRequest(BaseModel):
    role: OrganizationRole


class InviteCreateRequest(BaseModel):
    email: EmailStr
    role: OrganizationRole


class InviteOut(BaseModel):
    id: uuid.UUID
    email: str
    role: OrganizationRole
    expires_at: datetime
    created_at: datetime
    accepted_at: datetime | None
    # Só preenchido em ambiente de desenvolvimento, onde não existe envio
    # real de email (ver PROMPT 05 do CLAUDE.md).
    invite_url: str | None = None


class InvitePreviewOut(BaseModel):
    organization_name: str
    email: str
    role: OrganizationRole
    expires_at: datetime
    account_exists: bool


class InviteAcceptRequest(BaseModel):
    token: str
    # Obrigatório só quando o email do convite ainda não tem conta.
    name: str | None = Field(default=None, max_length=255)
    password: str = Field(min_length=8, max_length=128)
