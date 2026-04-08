from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from rebel_forge_backend.api.auth import require_owner
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.db.session import get_db
from rebel_forge_backend.services.heartbeat import HeartbeatService
from rebel_forge_backend.services.workspace import WorkspaceService

router = APIRouter()


class HeartbeatConfig(BaseModel):
    enabled: bool = False
    interval_hours: int = 6
    auto_approve: bool = False


@router.put("/heartbeat/config")
def update_heartbeat_config(
    payload: HeartbeatConfig, db: Session = Depends(get_db), _role: str = Depends(require_owner)
):
    settings = get_settings()
    ws = WorkspaceService(settings)
    workspace = ws.get_or_create_primary_workspace(db)
    bp = workspace.brand_profile

    if bp:
        style = bp.style_notes or {}
        style["heartbeat"] = {
            "enabled": payload.enabled,
            "interval_hours": payload.interval_hours,
            "auto_approve": payload.auto_approve,
        }
        bp.style_notes = style
        db.commit()

    return {"status": "saved", "config": payload.model_dump()}


@router.post("/heartbeat/trigger")
def trigger_heartbeat(db: Session = Depends(get_db), _role: str = Depends(require_owner)):
    """Manually trigger a heartbeat cycle. Queues it for the worker — does NOT block."""
    from rebel_forge_backend.db.models import Event
    from rebel_forge_backend.services.events import record_event
    from datetime import datetime, timezone

    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)

    # Remove the last heartbeat event so should_run() returns True on next worker check
    record_event(
        db,
        workspace_id=workspace.id,
        entity_type="workspace",
        entity_id=workspace.id,
        event_type="heartbeat.requested",
        payload={"triggered_by": "api"},
    )
    db.commit()

    # Run heartbeat directly in background thread instead of waiting for worker
    import threading

    def _run():
        from rebel_forge_backend.db.session import SessionLocal
        from rebel_forge_backend.services.events import record_event
        try:
            with SessionLocal() as bg_db:
                ws = WorkspaceService(get_settings()).get_or_create_primary_workspace(bg_db)
                hb = HeartbeatService(get_settings())
                hb.run(bg_db, ws)
        except Exception as e:
            import logging
            logging.getLogger("rebel_forge_backend.heartbeat").error("[heartbeat] Background run failed: %s", e)
            # Record completion so we don't retry forever
            try:
                with SessionLocal() as bg_db:
                    ws = WorkspaceService(get_settings()).get_or_create_primary_workspace(bg_db)
                    record_event(bg_db, workspace_id=ws.id, entity_type="workspace",
                                 entity_id=ws.id, event_type="heartbeat.completed",
                                 payload={"error": str(e)})
                    bg_db.commit()
            except Exception:
                pass

    threading.Thread(target=_run, daemon=True).start()

    return {"status": "running", "message": "Heartbeat started. Check Tasks page for progress."}


@router.post("/heartbeat/stop")
def stop_heartbeat(_role: str = Depends(require_owner)):
    """Signal the worker to skip the current heartbeat. Also cancels any pending draft generation jobs."""
    from rebel_forge_backend.db.models import Job, JobStatus
    from rebel_forge_backend.db.session import SessionLocal

    cancelled = 0
    with SessionLocal() as db:
        settings = get_settings()
        workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)

        # Cancel pending jobs
        from sqlalchemy import select, update
        result = db.execute(
            update(Job)
            .where(Job.workspace_id == workspace.id)
            .where(Job.status.in_(["pending"]))
            .values(status="failed", error_message="Cancelled by user")
        )
        cancelled = result.rowcount
        db.commit()

    return {"status": "stopped", "cancelled_jobs": cancelled}


@router.get("/heartbeat/status")
def heartbeat_status(db: Session = Depends(get_db), _role: str = Depends(require_owner)):
    """Check when the last heartbeat ran and when the next one is due."""
    from datetime import datetime, timezone
    from sqlalchemy import select
    from rebel_forge_backend.db.models import Event

    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)

    last_event = db.scalars(
        select(Event)
        .where(Event.workspace_id == workspace.id)
        .where(Event.event_type == "heartbeat.completed")
        .order_by(Event.created_at.desc())
        .limit(1)
    ).first()

    if last_event is None:
        return {
            "last_run": None,
            "next_run": "now (never run)",
            "interval_hours": 6,
        }

    elapsed_hours = (datetime.now(timezone.utc) - last_event.created_at).total_seconds() / 3600
    remaining = max(0, 6 - elapsed_hours)

    return {
        "last_run": last_event.created_at.isoformat(),
        "last_result": last_event.payload,
        "next_run": f"in {remaining:.1f} hours" if remaining > 0 else "now",
        "interval_hours": 6,
    }
