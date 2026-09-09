import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.enums import AssetStatus


class CheckResultOut(BaseModel):
    id: uuid.UUID
    check_id: uuid.UUID
    status: AssetStatus
    latency_ms: float | None
    packet_loss: float | None
    message: str | None
    checked_at: datetime
