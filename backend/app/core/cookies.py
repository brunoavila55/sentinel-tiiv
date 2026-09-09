from datetime import datetime

from fastapi import Response

from app.core.config import get_settings

settings = get_settings()


def set_refresh_cookie(response: Response, token: str, expires_at: datetime) -> None:
    # path restrito a /api/auth: o cookie só é enviado pelo browser nas
    # próprias rotas de autenticação, nunca em chamadas de API de negócio.
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        expires=expires_at,
        path="/api/auth",
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(key=settings.refresh_cookie_name, path="/api/auth")
