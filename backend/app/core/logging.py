"""Logging estruturado (PROMPT 24).

Formato JSON de propósito: em produção esses logs vão pra um coletor
(CloudWatch, Loki, o que for) que espera linhas parseáveis, não texto
livre. Campos padronizados: timestamp, level, service, message, e
organization_id/user_id/asset_id/check_id quando fizerem sentido pro
evento (passados via `extra=`).

Nunca logar senha, token, cookie ou segredo — nenhum código deste projeto
deve passar esses valores como `extra` nem interpolá-los na mensagem.
"""

import json
import logging
from datetime import datetime, timezone

_CONTEXT_FIELDS = ("organization_id", "user_id", "asset_id", "check_id")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "service": getattr(record, "service", "backend"),
            "message": record.getMessage(),
        }
        for field in _CONTEXT_FIELDS:
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = str(value)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(service: str, *, level: int = logging.INFO) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)

    # uvicorn instala os próprios handlers antes da gente; realinha pro
    # mesmo formato JSON em vez de deixar as duas saídas com formatos
    # diferentes no mesmo stdout.
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
        logging.getLogger(name).handlers = []
        logging.getLogger(name).propagate = True

    old_factory = logging.getLogRecordFactory()

    def record_factory(*args: object, **kwargs: object) -> logging.LogRecord:
        record = old_factory(*args, **kwargs)  # type: ignore[arg-type]
        record.service = service
        return record

    logging.setLogRecordFactory(record_factory)
