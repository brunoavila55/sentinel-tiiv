from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.cookies import clear_refresh_cookie, set_refresh_cookie
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.rate_limit import rate_limit_login, rate_limit_register
from app.models.user import User
from app.repositories import organization_repository
from app.schemas.auth import (
    AccessTokenResponse,
    ChangePasswordRequest,
    LoginRequest,
    MeResponse,
    OrganizationMembershipOut,
    RegisterRequest,
    UserOut,
)
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _to_access_token_response(result: auth_service.AuthResult) -> AccessTokenResponse:
    return AccessTokenResponse(
        access_token=result.access_token,
        expires_at=result.access_token_expires_at,
        user=UserOut.model_validate(result.user),
    )


@router.post(
    "/register",
    response_model=AccessTokenResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit_register)],
)
async def register(
    payload: RegisterRequest, request: Request, response: Response, db: AsyncSession = Depends(get_db)
) -> AccessTokenResponse:
    result = await auth_service.register(
        db,
        name=payload.name,
        email=payload.email,
        password=payload.password,
        organization_name=payload.organization_name,
        user_agent=request.headers.get("user-agent"),
        ip_address=_client_ip(request),
    )
    set_refresh_cookie(response, result.refresh_token, result.refresh_token_expires_at)
    return _to_access_token_response(result)


@router.post("/login", response_model=AccessTokenResponse, dependencies=[Depends(rate_limit_login)])
async def login(
    payload: LoginRequest, request: Request, response: Response, db: AsyncSession = Depends(get_db)
) -> AccessTokenResponse:
    result = await auth_service.login(
        db,
        email=payload.email,
        password=payload.password,
        user_agent=request.headers.get("user-agent"),
        ip_address=_client_ip(request),
    )
    set_refresh_cookie(response, result.refresh_token, result.refresh_token_expires_at)
    return _to_access_token_response(result)


@router.post("/refresh", response_model=AccessTokenResponse)
async def refresh(request: Request, response: Response, db: AsyncSession = Depends(get_db)) -> AccessTokenResponse:
    refresh_token_value = request.cookies.get(settings.refresh_cookie_name)
    result = await auth_service.refresh(
        db,
        refresh_token_value=refresh_token_value,
        user_agent=request.headers.get("user-agent"),
        ip_address=_client_ip(request),
    )
    set_refresh_cookie(response, result.refresh_token, result.refresh_token_expires_at)
    return _to_access_token_response(result)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db)) -> None:
    refresh_token_value = request.cookies.get(settings.refresh_cookie_name)
    await auth_service.logout(db, refresh_token_value=refresh_token_value)
    clear_refresh_cookie(response)


@router.get("/me", response_model=MeResponse)
async def me(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> MeResponse:
    memberships = await organization_repository.list_memberships_for_user(db, current_user.id)
    return MeResponse(
        user=UserOut.model_validate(current_user),
        memberships=[
            OrganizationMembershipOut(
                organization_id=m.organization_id,
                organization_name=m.organization.name,
                organization_slug=m.organization.slug,
                role=m.role,
            )
            for m in memberships
        ],
    )


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await auth_service.change_password(
        db, user=current_user, current_password=payload.current_password, new_password=payload.new_password
    )
