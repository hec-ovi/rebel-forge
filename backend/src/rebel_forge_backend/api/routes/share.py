"""
Shareable approval links — clients can view and approve content without login.
Uses the viewer token as a lightweight auth for shared views.
"""
import secrets
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from rebel_forge_backend.api.auth import require_owner
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.db.models import ContentDraft, DraftStatus
from rebel_forge_backend.db.session import get_db
from rebel_forge_backend.services.workspace import WorkspaceService

router = APIRouter()


class ShareLinkCreate(BaseModel):
    draft_ids: list[str] | None = None  # None = share all pending
    expires_hours: int = 72


class ShareLinkResponse(BaseModel):
    share_id: str
    url: str
    expires_at: str
    draft_count: int


class SharedDraft(BaseModel):
    id: str
    platform: str
    status: str
    concept: str
    caption: str
    hook: str
    cta: str
    hashtags: list[str]
    media_prompt: str | None = None


# In-memory share store (simple for now — move to DB if needed)
_share_store: dict[str, dict] = {}


@router.post("/share", response_model=ShareLinkResponse)
def create_share_link(
    payload: ShareLinkCreate,
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    """Create a shareable link for clients to view/approve content."""
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)

    # Get drafts to share
    if payload.draft_ids:
        drafts = [db.get(ContentDraft, did) for did in payload.draft_ids]
        drafts = [d for d in drafts if d is not None]
    else:
        # Share all pending drafts
        drafts = db.scalars(
            select(ContentDraft)
            .where(ContentDraft.workspace_id == workspace.id)
            .where(ContentDraft.status.in_(["draft", "reviewed"]))
            .order_by(ContentDraft.created_at.desc())
            .limit(20)
        ).all()

    if not drafts:
        raise HTTPException(status_code=400, detail="No drafts to share")

    share_id = secrets.token_urlsafe(16)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=payload.expires_hours)

    _share_store[share_id] = {
        "workspace_id": str(workspace.id),
        "draft_ids": [str(d.id) for d in drafts],
        "expires_at": expires_at.isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    return ShareLinkResponse(
        share_id=share_id,
        url=f"/share/{share_id}",
        expires_at=expires_at.isoformat(),
        draft_count=len(drafts),
    )


@router.get("/share/{share_id}")
def get_shared_content(share_id: str, db: Session = Depends(get_db)):
    """Public endpoint — no auth required. Returns shared drafts for client review."""
    share = _share_store.get(share_id)
    if not share:
        raise HTTPException(status_code=404, detail="Share link not found or expired")

    # Check expiry
    expires_at = datetime.fromisoformat(share["expires_at"])
    if datetime.now(timezone.utc) > expires_at:
        del _share_store[share_id]
        raise HTTPException(status_code=410, detail="Share link has expired")

    drafts = []
    for did in share["draft_ids"]:
        draft = db.get(ContentDraft, did)
        if draft:
            drafts.append(SharedDraft(
                id=str(draft.id),
                platform=draft.platform,
                status=draft.status if isinstance(draft.status, str) else draft.status.value,
                concept=draft.concept,
                caption=draft.caption,
                hook=draft.hook,
                cta=draft.cta,
                hashtags=draft.hashtags,
                media_prompt=draft.media_prompt,
            ))

    return {
        "share_id": share_id,
        "expires_at": share["expires_at"],
        "drafts": [d.model_dump() for d in drafts],
    }


@router.post("/share/{share_id}/approve/{draft_id}")
def approve_shared_draft(share_id: str, draft_id: str, db: Session = Depends(get_db)):
    """Public endpoint — client approves a draft via share link."""
    share = _share_store.get(share_id)
    if not share:
        raise HTTPException(status_code=404, detail="Share link not found or expired")

    expires_at = datetime.fromisoformat(share["expires_at"])
    if datetime.now(timezone.utc) > expires_at:
        raise HTTPException(status_code=410, detail="Share link has expired")

    if draft_id not in share["draft_ids"]:
        raise HTTPException(status_code=403, detail="Draft not in this share")

    draft = db.get(ContentDraft, draft_id)
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")

    if draft.status in (DraftStatus.DRAFT.value, DraftStatus.REVIEWED.value):
        draft.status = DraftStatus.APPROVED
        db.commit()

        from rebel_forge_backend.services.events import record_event
        record_event(db, workspace_id=draft.workspace_id, entity_type="content_draft",
                     entity_id=draft.id, event_type="draft.approved",
                     payload={"approved_via": "share_link", "share_id": share_id})
        db.commit()

    return {"status": "approved", "draft_id": draft_id}


@router.get("/shares")
def list_shares(_role: str = Depends(require_owner)):
    """List active share links."""
    now = datetime.now(timezone.utc)
    active = []
    expired_keys = []

    for sid, share in _share_store.items():
        expires_at = datetime.fromisoformat(share["expires_at"])
        if now > expires_at:
            expired_keys.append(sid)
        else:
            active.append({
                "share_id": sid,
                "url": f"/share/{sid}",
                "draft_count": len(share["draft_ids"]),
                "expires_at": share["expires_at"],
                "created_at": share["created_at"],
            })

    # Clean expired
    for k in expired_keys:
        del _share_store[k]

    return active
