import uuid
from datetime import datetime

from pydantic import BaseModel, Field

# Limites de negócio (Prompt 19 pede "validar intervalos mínimos e máximos
# definidos pelo backend" — definidos aqui, não deixados livres).
MIN_INTERVAL_SECONDS = 10
MAX_INTERVAL_SECONDS = 3600
MIN_TIMEOUT_SECONDS = 1
MAX_TIMEOUT_SECONDS = 60
MIN_PACKETS = 1
MAX_PACKETS = 10


class CheckCreateRequest(BaseModel):
    # Só "ping" é aceito hoje (validado no service, não travado por enum de
    # banco — ver decisão em app/models/check.py), mas o campo já existe.
    type: str = Field(default="ping", max_length=50)
    enabled: bool = True
    interval_seconds: int = Field(default=30, ge=MIN_INTERVAL_SECONDS, le=MAX_INTERVAL_SECONDS)
    timeout_seconds: int = Field(default=1, ge=MIN_TIMEOUT_SECONDS, le=MAX_TIMEOUT_SECONDS)
    # "packets" é campo de primeira classe na API — nunca expomos o JSON
    # cru de `config` para o usuário (Prompt 19). Internamente ainda vira
    # config={"packets": N} porque o modelo de dados (Prompt 02) já fixou
    # `config` como o lugar genérico pra configuração por tipo de check.
    packets: int = Field(default=3, ge=MIN_PACKETS, le=MAX_PACKETS)


class CheckUpdateRequest(BaseModel):
    enabled: bool | None = None
    interval_seconds: int | None = Field(default=None, ge=MIN_INTERVAL_SECONDS, le=MAX_INTERVAL_SECONDS)
    timeout_seconds: int | None = Field(default=None, ge=MIN_TIMEOUT_SECONDS, le=MAX_TIMEOUT_SECONDS)
    packets: int | None = Field(default=None, ge=MIN_PACKETS, le=MAX_PACKETS)


class CheckOut(BaseModel):
    id: uuid.UUID
    asset_id: uuid.UUID
    type: str
    enabled: bool
    interval_seconds: int
    timeout_seconds: int
    packets: int
    next_check_at: datetime | None
    last_check_at: datetime | None
    consecutive_successes: int
    consecutive_failures: int
    created_at: datetime
    updated_at: datetime
