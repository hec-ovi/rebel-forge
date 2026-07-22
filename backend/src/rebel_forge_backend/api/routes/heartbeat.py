from datetime import UTC

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from rebel_forge_backend.api.auth import require_owner
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.db.session import get_db
from rebel_forge_backend.services.workspace import WorkspaceService

router = APIRouter()


class HeartbeatConfig(BaseModel):
    enabled: bool = False
    interval_hours: int = Field(default=6, ge=1, le=720)
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
        style = dict(bp.style_notes or {})
        style["heartbeat"] = {
            "enabled": payload.enabled,
            "interval_hours": payload.interval_hours,
            "auto_approve": payload.auto_approve,
        }
        bp.style_notes = style
        db.commit()

    return {"status": "saved", "config": payload.model_dump()}


@router.post("/heartbeat/trigger", status_code=202)
def trigger_heartbeat(db: Session = Depends(get_db), _role: str = Depends(require_owner)):
    """Persist a manual heartbeat request for the worker without blocking the API."""

    from rebel_forge_backend.services.events import record_event

    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)

    record_event(
        db,
        workspace_id=workspace.id,
        entity_type="workspace",
        entity_id=workspace.id,
        event_type="heartbeat.requested",
        payload={"triggered_by": "api"},
    )
    db.commit()

    return {
        "status": "queued",
        "message": "Heartbeat queued for the worker. Check Tasks for progress.",
    }


@router.post("/heartbeat/stop")
def stop_heartbeat(db: Session = Depends(get_db), _role: str = Depends(require_owner)):
    """Cancel pending draft jobs created by heartbeat; an active cycle cannot be interrupted."""
    from sqlalchemy import select

    from rebel_forge_backend.db.models import Job, JobStatus

    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    pending_jobs = db.scalars(
        select(Job).where(
            Job.workspace_id == workspace.id,
            Job.status == JobStatus.PENDING,
        )
    ).all()
    cancelled = 0
    for job in pending_jobs:
        if (job.input_payload or {}).get("source") == "heartbeat":
            job.status = JobStatus.FAILED
            job.error_message = "Cancelled by user before heartbeat generation started"
            cancelled += 1
    db.commit()

    return {
        "status": "pending_heartbeat_jobs_cancelled",
        "cancelled_jobs": cancelled,
        "active_cycle_stopped": False,
    }


@router.get("/heartbeat/status")
def heartbeat_status(db: Session = Depends(get_db), _role: str = Depends(require_owner)):
    """Check when the last heartbeat ran and when the next one is due."""
    from datetime import datetime

    from sqlalchemy import select

    from rebel_forge_backend.db.models import Event

    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    bp = workspace.brand_profile
    config = (bp.style_notes or {}).get("heartbeat", {}) if bp else {}
    interval_hours = HeartbeatConfig(**config).interval_hours

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
            "interval_hours": interval_hours,
        }

    elapsed_hours = (datetime.now(UTC) - last_event.created_at).total_seconds() / 3600
    remaining = max(0, interval_hours - elapsed_hours)

    return {
        "last_run": last_event.created_at.isoformat(),
        "last_result": last_event.payload,
        "next_run": f"in {remaining:.1f} hours" if remaining > 0 else "now",
        "interval_hours": interval_hours,
    }
