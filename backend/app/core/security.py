import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import Argon2Error

from app.core.config import get_settings

settings = get_settings()

_password_hasher = PasswordHasher()

_JWT_ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


# Hash "de descarte" com formato válido, usado só pra gastar o mesmo tempo
# de CPU que um verify_password real quando o usuário não existe — sem
# isso, login com email inexistente responde bem mais rápido que login com
# email existente e senha errada, o que dá pra um atacante enumerar emails
# cadastrados só medindo o tempo de resposta (PROMPT 25).
DUMMY_PASSWORD_HASH = _password_hasher.hash("sentinel-dummy-password-for-timing-normalization")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _password_hasher.verify(password_hash, password)
    except Argon2Error:
        return False


def create_access_token(user_id: uuid.UUID) -> tuple[str, datetime]:
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": str(user_id), "type": "access", "exp": expires_at}
    token = jwt.encode(payload, settings.secret_key, algorithm=_JWT_ALGORITHM)
    return token, expires_at


def decode_access_token(token: str) -> uuid.UUID:
    """Levanta jwt.PyJWTError (ou subclasses) se o token for inválido/expirado."""
    payload = jwt.decode(token, settings.secret_key, algorithms=[_JWT_ALGORITHM])
    if payload.get("type") != "access":
        raise jwt.InvalidTokenError("tipo de token inválido")
    return uuid.UUID(payload["sub"])


def generate_secure_token(n_bytes: int = 48) -> str:
    """Token opaco de alta entropia, para qualquer uso que precise de um
    segredo de posse única (refresh token, convite). Nunca é armazenado em
    texto puro — ver hash_token."""
    return secrets.token_urlsafe(n_bytes)


def generate_refresh_token() -> str:
    return generate_secure_token()


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
