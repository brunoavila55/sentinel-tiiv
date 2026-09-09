import uuid
from datetime import datetime

from pydantic import BaseModel


class AuditLogOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID | None
    user_name: str | None
    action: str
    entity_type: str
    entity_id: uuid.UUID | None
    metadata: dict | None
    created_at: datetime
