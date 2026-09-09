"""Middleware de log por request + handler de exceção não tratada (PROMPT 24).

Não loga corpo da requisição (nunca risco de logar senha/token de um
payload) nem um log por pacote ICMP — só uma linha por request HTTP, com
método, path, status, duração e organization_id quando o cliente mandou o
header (não validamos aqui; é só correlação de log, a validação de
verdade já acontece nas dependencies de auth de cada rota).
"""

import logging
import time
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response, status
from fastapi.responses import JSONResponse

logger = logging.getLogger("sentinel.request")


async def log_requests(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    start = time.monotonic()
    response = await call_next(request)
    duration_ms = round((time.monotonic() - start) * 1000, 1)

    logger.info(
        "%s %s -> %d (%sms)",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
        extra={"organization_id": request.headers.get("x-organization-id")},
    )
    return response


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        # Loga com stack trace pro nosso lado; nunca devolve o stack trace
        # ou a mensagem crua da exceção pro cliente (poderia vazar detalhe
        # interno — nome de tabela, driver, caminho de arquivo).
        logger.exception(
            "erro não tratado em %s %s",
            request.method,
            request.url.path,
            extra={"organization_id": request.headers.get("x-organization-id")},
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "Erro interno. Tente novamente."},
        )
