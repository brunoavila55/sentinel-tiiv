import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.enums import AssetStatus


class ProblemOut(BaseModel):
    asset_id: uuid.UUID
    asset_name: str
    site_name: str
    ip_or_hostname: str
    status: AssetStatus
    status_since: datetime | None
    last_rtt_ms: float | None
    last_check_at: datetime | None
    # Mensagem normalizada do check_result mais recente ("Sem resposta
    # ICMP" etc.) — o "problema" em si, não só o status.
    message: str | None
