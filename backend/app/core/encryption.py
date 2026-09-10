"""Criptografia simétrica para segredos armazenados que precisam ser
recuperados em texto claro (ex.: senha de acesso de um ativo).

Diferente de core/security.py — que só faz hash one-way para senhas de
usuário — aqui o valor volta a ser legível para quem tem permissão. A chave
Fernet é derivada de SECRET_KEY via SHA-256 (não é o SECRET_KEY bruto), para
não reaproveitar o mesmo material entre assinatura de JWT e criptografia de
segredos.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings

settings = get_settings()


def _fernet() -> Fernet:
    digest = hashlib.sha256(settings.secret_key.encode("utf-8")).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def encrypt_secret(plain: str) -> str:
    return _fernet().encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt_secret(token: str) -> str | None:
    """None se o token estiver corrompido/ilegível (ex.: SECRET_KEY trocada)
    em vez de derrubar a requisição inteira por causa de um campo."""
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken:
        return None
