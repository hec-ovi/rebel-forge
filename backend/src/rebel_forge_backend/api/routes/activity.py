from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from rebel_forge_backend.api.auth import require_owner
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.db.models import Event
from rebel_forge_backend.db.session import get_db
from rebel_forge_backend.services.workspace import WorkspaceService

router = APIRouter()


@router.get("/activity")
def list_activity(
    limit: int = Query(default=50, le=200),
    event_type: str | None = None,
    before: str | None = None,
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    """Get recent activity/events for debugging and tracing."""
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)

    query = (
        select(Event)
        .where(Event.workspace_id == workspace.id)
        .order_by(Event.created_at.desc())
        .limit(limit)
    )

    if event_type:
        query = query.where(Event.event_type == event_type)

    if before:
        from uuid import UUID as _UUID
        try:
            before_event = db.get(Event, _UUID(before))
            if before_event:
                query = query.where(Event.created_at < before_event.created_at)
        except (ValueError, Exception):
            pass

    events = db.scalars(query).all()

    return [
        {
            "id": str(e.id),
            "event_type": e.event_type,
            "entity_type": e.entity_type,
            "entity_id": str(e.entity_id),
            "payload": e.payload,
            "created_at": e.created_at.isoformat(),
        }
        for e in events
    ]
