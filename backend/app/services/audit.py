from typing import Any
from ipaddress import ip_address as parse_ip_address
from uuid import UUID
from sqlalchemy.orm import Session
from app.models.entities import AuditLog

def record_audit(
    db: Session,
    *,
    action: str,
    user_id: UUID | None = None,
    entity_type: str | None = None,
    entity_id: UUID | None = None,
    metadata: Any = None,
    ip_address: str | None = None,
) -> AuditLog:
    # PostgreSQL INET accepts addresses only. A malformed proxy/client host must
    # never turn an otherwise valid action (including login) into a DB error.
    if ip_address:
        try:
            ip_address = str(parse_ip_address(ip_address))
        except ValueError:
            ip_address = None
    row = AuditLog(user_id=user_id, action=action, entity_type=entity_type, entity_id=entity_id, metadata_json=metadata, ip_address=ip_address)
    db.add(row)
    return row
