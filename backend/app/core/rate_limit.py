"""Rate limiting simples em memória para endpoints sensíveis (PROMPT 25).

Só cobre os endpoints onde um limite ausente é um risco real: login (força
bruta de senha), registro (spam de contas) e convites (adivinhação de
token ou enumeração via preview). Não é um rate limiter genérico de API.

Em memória de propósito: o modelo atual é um único processo por container
(ver docker-compose.yml), e adicionar Redis só para isso contradiria a
simplicidade que o projeto prioriza (CLAUDE.md proíbe Redis sem
necessidade concreta). Limitação conhecida e documentada no README: com
múltiplas réplicas do backend atrás de um load balancer, cada réplica
contaria as tentativas separadamente — nesse cenário, um limiter
compartilhado (Redis ou equivalente) deixaria de ser opcional.
"""

import time
from collections import defaultdict
from threading import Lock

from fastapi import HTTPException, Request, status

TOO_MANY_REQUESTS = HTTPException(
    status.HTTP_429_TOO_MANY_REQUESTS,
    "Muitas tentativas. Aguarde um momento e tente novamente.",
)


class _RateLimiter:
    def __init__(self, *, max_attempts: int, window_seconds: float) -> None:
        self._max_attempts = max_attempts
        self._window_seconds = window_seconds
        self._hits: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        cutoff = now - self._window_seconds
        with self._lock:
            hits = self._hits[key]
            while hits and hits[0] < cutoff:
                hits.pop(0)
            if len(hits) >= self._max_attempts:
                raise TOO_MANY_REQUESTS
            hits.append(now)


def _client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


# Limites deliberadamente folgados o bastante pra não incomodar um usuário
# real errando a senha algumas vezes, mas curtos o bastante pra tornar
# força bruta impraticável.
_login_limiter = _RateLimiter(max_attempts=10, window_seconds=60)
_register_limiter = _RateLimiter(max_attempts=5, window_seconds=60)
_invite_limiter = _RateLimiter(max_attempts=20, window_seconds=60)


def rate_limit_login(request: Request) -> None:
    _login_limiter.check(f"login:{_client_key(request)}")


def rate_limit_register(request: Request) -> None:
    _register_limiter.check(f"register:{_client_key(request)}")


def rate_limit_invite(request: Request) -> None:
    _invite_limiter.check(f"invite:{_client_key(request)}")


def reset_all() -> None:
    """Zera o estado dos limiters. Só existe para os testes: todo o cliente
    de teste bate como o mesmo IP ("testclient"), então sem resetar entre
    testes o limiter global acumularia hits de casos anteriores e derrubaria
    testes não relacionados com 429."""
    for limiter in (_login_limiter, _register_limiter, _invite_limiter):
        limiter._hits.clear()
