from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cookies import set_refresh_cookie
from app.core.database import get_db
from app.core.rate_limit import rate_limit_invite
from app.schemas.auth import AccessTokenResponse, UserOut
from app.schemas.organization import InviteAcceptRequest, InvitePreviewOut
from app.services import invite_service

router = APIRouter(prefix="/invites", tags=["invites"])


@router.get("/{token}", response_model=InvitePreviewOut, dependencies=[Depends(rate_limit_invite)])
async def preview_invite(token: str, db: AsyncSession = Depends(get_db)) -> InvitePreviewOut:
    preview = await invite_service.preview_invite(db, token=token)
    return InvitePreviewOut(
        organization_name=preview.organization_name,
        email=preview.email,
        role=preview.role,
        expires_at=preview.expires_at,
        account_exists=preview.account_exists,
    )


@router.post("/accept", response_model=AccessTokenResponse, dependencies=[Depends(rate_limit_invite)])
async def accept_invite(
    payload: InviteAcceptRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> AccessTokenResponse:
    result = await invite_service.accept_invite(
        db,
        token=payload.token,
        name=payload.name,
        password=payload.password,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    # Mesma política de cookie do login/register: aceitar convite também
    # autentica o usuário imediatamente.
    set_refresh_cookie(response, result.refresh_token, result.refresh_token_expires_at)
    return AccessTokenResponse(
        access_token=result.access_token,
        expires_at=result.access_token_expires_at,
        user=UserOut.model_validate(result.user),
    )
