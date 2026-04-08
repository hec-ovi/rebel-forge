from uuid import UUID

from sqlalchemy.orm import Session

from rebel_forge_backend.db.models import Event


def record_event(
    db: Session,
    *,
    workspace_id: UUID,
    entity_type: str,
    entity_id: UUID | None,
    event_type: str,
    payload: dict | None = None,
) -> Event:
    event = Event(
        workspace_id=workspace_id,
        entity_type=entity_type,
        entity_id=entity_id,
        event_type=event_type,
        payload=payload or {},
    )
    db.add(event)
    return event

