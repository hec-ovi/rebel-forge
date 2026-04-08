"""Notification preferences persistence."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from rebel_forge_backend.api.auth import require_owner
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.db.session import get_db
from rebel_forge_backend.services.workspace import WorkspaceService

router = APIRouter()


class NotificationPrefs(BaseModel):
    draft_ready: bool = True
    publish_failed: bool = True
    performance_alert: bool = True
    heartbeat_summary: bool = False


@router.get("/workspace/notifications", response_model=NotificationPrefs)
def get_notification_prefs(db: Session = Depends(get_db), _role: str = Depends(require_owner)):
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    bp = workspace.brand_profile

    prefs = {}
    if bp and bp.style_notes:
        prefs = bp.style_notes.get("notifications", {})

    return NotificationPrefs(**prefs) if prefs else NotificationPrefs()


@router.put("/workspace/notifications", response_model=NotificationPrefs)
def update_notification_prefs(payload: NotificationPrefs, db: Session = Depends(get_db), _role: str = Depends(require_owner)):
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    bp = workspace.brand_profile

    if bp:
        style = bp.style_notes or {}
        style["notifications"] = payload.model_dump()
        bp.style_notes = style
        db.commit()

    return payload
