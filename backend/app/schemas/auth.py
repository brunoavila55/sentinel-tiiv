import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.models.enums import OrganizationRole, UserStatus


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    organization_name: str = Field(min_length=1, max_length=255)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class UserOut(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    status: UserStatus
    created_at: datetime

    model_config = {"from_attributes": True}


class OrganizationMembershipOut(BaseModel):
    organization_id: uuid.UUID
    organization_name: str
    organization_slug: str
    role: OrganizationRole


class MeResponse(BaseModel):
    user: UserOut
    memberships: list[OrganizationMembershipOut]


class AccessTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: UserOut
