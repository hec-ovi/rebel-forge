from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from rebel_forge_backend.api.auth import require_owner, require_viewer
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.db.models import ContentDraft, DraftStatus, JobType
from rebel_forge_backend.db.session import get_db
from rebel_forge_backend.schemas.drafts import DraftGenerationRequest, DraftRead
from rebel_forge_backend.schemas.jobs import JobRead
from rebel_forge_backend.services.events import record_event
from rebel_forge_backend.services.jobs import JobService

import logging

_logger = logging.getLogger("rebel_forge_backend.drafts")


def _fetch_live_metrics(platform: str, post_id: str, settings) -> dict | None:
    """Fetch live engagement metrics from platform API. Returns None on failure."""
    try:
        if platform == "x":
            import requests
            from requests_oauthlib import OAuth1
            auth = OAuth1(settings.x_consumer_key, settings.x_consumer_secret,
                          settings.x_access_token, settings.x_access_token_secret)
            r = requests.get(
                f"https://api.twitter.com/2/tweets/{post_id}",
                params={"tweet.fields": "public_metrics,created_at"},
                auth=auth, timeout=10,
            )
            if r.status_code == 200:
                data = r.json().get("data", {})
                metrics = data.get("public_metrics", {})
                return {
                    "views": metrics.get("impression_count", 0),
                    "likes": metrics.get("like_count", 0),
                    "comments": metrics.get("reply_count", 0),
                    "shares": metrics.get("retweet_count", 0) + metrics.get("quote_count", 0),
                    "bookmarks": metrics.get("bookmark_count", 0),
                }

        elif platform == "linkedin":
            # LinkedIn analytics requires specific permissions — skip for now
            return None

        elif platform == "facebook":
            import httpx
            r = httpx.get(
                f"https://graph.facebook.com/v23.0/{post_id}",
                params={"fields": "likes.summary(true),comments.summary(true),shares",
                        "access_token": settings.facebook_page_token},
                timeout=10.0,
            )
            if r.status_code == 200:
                data = r.json()
                return {
                    "likes": data.get("likes", {}).get("summary", {}).get("total_count", 0),
                    "comments": data.get("comments", {}).get("summary", {}).get("total_count", 0),
                    "shares": data.get("shares", {}).get("count", 0),
                }

        elif platform == "instagram":
            import httpx
            r = httpx.get(
                f"https://graph.instagram.com/v23.0/{post_id}",
                params={"fields": "like_count,comments_count",
                        "access_token": settings.instagram_access_token},
                timeout=10.0,
            )
            if r.status_code == 200:
                data = r.json()
                return {
                    "likes": data.get("like_count", 0),
                    "comments": data.get("comments_count", 0),
                }

    except Exception as e:
        _logger.warning("[engagement] Failed to fetch %s metrics for %s: %s", platform, post_id, e)

    return None
from rebel_forge_backend.services.workspace import WorkspaceService

router = APIRouter()


@router.get("/drafts")
def list_drafts(db: Session = Depends(get_db), _role: str = Depends(require_viewer)):
    """List drafts with image URLs attached."""
    from rebel_forge_backend.db.models import Asset, AssetStatus
    workspace = WorkspaceService(get_settings()).get_or_create_primary_workspace(db)
    query = (
        select(ContentDraft)
        .where(ContentDraft.workspace_id == workspace.id)
        .order_by(ContentDraft.created_at.desc())
        .limit(50)
    )
    drafts = db.scalars(query).all()

    # Batch load images and publish URLs for all drafts
    from rebel_forge_backend.db.models import PublishedPost
    draft_ids = [d.id for d in drafts]
    assets = db.scalars(
        select(Asset)
        .where(Asset.draft_id.in_(draft_ids))
        .where(Asset.status == AssetStatus.READY)
    ).all()
    image_map = {}
    for a in assets:
        if a.draft_id and a.draft_id not in image_map:
            image_map[a.draft_id] = a.public_url or a.external_url

    pubs = db.scalars(
        select(PublishedPost)
        .where(PublishedPost.draft_id.in_(draft_ids))
    ).all()
    pub_map = {}
    for p in pubs:
        if p.draft_id and p.draft_id not in pub_map:
            url = (p.metadata_json or {}).get("url") or (p.metadata_json or {}).get("platform_url")
            pub_map[p.draft_id] = url

    results = []
    for draft in drafts:
        d = DraftRead.model_validate(draft).model_dump()
        d["image_url"] = image_map.get(draft.id)
        d["published_url"] = pub_map.get(draft.id)
        results.append(d)
    return results


@router.get("/drafts/{draft_id}")
def get_draft(draft_id: str, db: Session = Depends(get_db), _role: str = Depends(require_viewer)):
    """Get a single draft with its image asset and publish info."""
    from rebel_forge_backend.db.models import Asset, AssetStatus, PublishedPost
    draft = db.get(ContentDraft, draft_id)
    if not draft:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Draft not found")

    result = DraftRead.model_validate(draft).model_dump()

    # Attach image
    asset = db.scalars(
        select(Asset)
        .where(Asset.draft_id == draft.id)
        .where(Asset.status == AssetStatus.READY)
        .order_by(Asset.created_at.desc())
        .limit(1)
    ).first()
    result["image_url"] = asset.public_url or asset.external_url if asset else None

    # Attach publish info
    pub = db.scalars(
        select(PublishedPost)
        .where(PublishedPost.draft_id == draft.id)
        .order_by(PublishedPost.published_at.desc())
        .limit(1)
    ).first()
    result["published_url"] = ((pub.metadata_json or {}).get("url") or (pub.metadata_json or {}).get("platform_url")) if pub else None
    result["published_at"] = pub.published_at.isoformat() if pub else None
    result["platform_post_id"] = pub.platform_post_id if pub else None

    return result


@router.post("/drafts/generate", response_model=JobRead)
def generate_drafts(
    payload: DraftGenerationRequest, db: Session = Depends(get_db), _role: str = Depends(require_owner)
) -> JobRead:
    workspace = WorkspaceService(get_settings()).get_or_create_primary_workspace(db)
    job = JobService().enqueue_job(
        db,
        workspace_id=workspace.id,
        job_type=JobType.DRAFT_GENERATION,
        input_payload=payload.model_dump(mode="json"),
    )
    return JobRead.model_validate(job)


class DraftApproveRequest(BaseModel):
    caption: str | None = None


@router.post("/drafts/{draft_id}/approve", response_model=DraftRead)
def approve_draft(
    draft_id: UUID,
    payload: DraftApproveRequest | None = None,
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
) -> DraftRead:
    draft = db.get(ContentDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    if draft.status != DraftStatus.DRAFT.value and draft.status != DraftStatus.REVIEWED.value:
        raise HTTPException(status_code=400, detail=f"Cannot approve draft in status '{draft.status}'")

    had_edits = payload is not None and payload.caption is not None and payload.caption != draft.caption
    original_caption = draft.caption

    if had_edits:
        draft.caption = payload.caption

    draft.status = DraftStatus.APPROVED
    db.commit()
    db.refresh(draft)

    record_event(
        db,
        workspace_id=draft.workspace_id,
        entity_type="content_draft",
        entity_id=draft.id,
        event_type="draft.approved",
        payload={"had_edits": had_edits},
    )

    # Store correction for learning (simple md file, no embeddings)
    if had_edits:
        from rebel_forge_backend.services.corrections import store_correction
        try:
            store_correction(
                db=db,
                workspace_id=draft.workspace_id,
                draft_id=draft.id,
                original_text=original_caption,
                corrected_text=payload.caption,
                context={"platform": draft.platform, "concept": draft.concept},
            )
        except Exception as e:
            import logging
            logging.getLogger("rebel_forge_backend").error("[corrections] Failed: %s", e)

    return DraftRead.model_validate(draft)


@router.put("/drafts/{draft_id}")
def update_draft(
    draft_id: UUID, payload: dict, db: Session = Depends(get_db), _role: str = Depends(require_owner)
):
    """Update a draft's content. Reverts approved drafts back to draft status."""
    draft = db.get(ContentDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    if str(draft.status.value if hasattr(draft.status, 'value') else draft.status) == "published":
        raise HTTPException(status_code=400, detail="Cannot edit published content")

    # Update fields
    if "caption" in payload:
        draft.caption = payload["caption"]
    if "hook" in payload:
        draft.hook = payload["hook"]
    if "cta" in payload:
        draft.cta = payload["cta"]
    if "concept" in payload:
        draft.concept = payload["concept"]

    # If was approved, revert to draft (needs re-approval)
    from rebel_forge_backend.db.models import DraftStatus
    if draft.status == DraftStatus.APPROVED:
        draft.status = DraftStatus.DRAFT

    db.commit()
    db.refresh(draft)
    return DraftRead.model_validate(draft)


@router.delete("/drafts/{draft_id}")
def delete_draft(
    draft_id: UUID, db: Session = Depends(get_db), _role: str = Depends(require_owner)
):
    """Permanently delete a draft and its assets."""
    from rebel_forge_backend.db.models import Asset, PublishedPost
    draft = db.get(ContentDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")

    # Delete related assets
    db.execute(select(Asset).where(Asset.draft_id == draft_id).with_only_columns(Asset.id))
    for asset in db.scalars(select(Asset).where(Asset.draft_id == draft_id)).all():
        db.delete(asset)

    # Delete related published posts
    for pub in db.scalars(select(PublishedPost).where(PublishedPost.draft_id == draft_id)).all():
        db.delete(pub)

    db.delete(draft)
    db.commit()

    record_event(
        db,
        workspace_id=draft.workspace_id,
        entity_type="content_draft",
        entity_id=draft_id,
        event_type="draft.deleted",
        payload={},
    )

    return {"status": "deleted", "id": str(draft_id)}


@router.post("/drafts/{draft_id}/reject", response_model=DraftRead)
def reject_draft(
    draft_id: UUID, db: Session = Depends(get_db), _role: str = Depends(require_owner)
) -> DraftRead:
    draft = db.get(ContentDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")

    draft.status = DraftStatus.FAILED
    db.commit()
    db.refresh(draft)

    record_event(
        db,
        workspace_id=draft.workspace_id,
        entity_type="content_draft",
        entity_id=draft.id,
        event_type="draft.rejected",
        payload={},
    )
    db.commit()

    return DraftRead.model_validate(draft)


@router.get("/drafts/{draft_id}/engagement")
def get_draft_engagement(draft_id: UUID, db: Session = Depends(get_db), _role: str = Depends(require_viewer)):
    """Get engagement metrics for a published draft. Fetches live from platform API."""
    from rebel_forge_backend.db.models import PublishedPost, MetricSnapshot
    from rebel_forge_backend.core.config import get_settings as _get_settings

    draft = db.get(ContentDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")

    published = db.scalars(
        select(PublishedPost)
        .where(PublishedPost.draft_id == draft_id)
        .order_by(PublishedPost.created_at.desc())
        .limit(1)
    ).first()

    if not published:
        return {"draft_id": str(draft_id), "published": False, "metrics": None}

    # Fetch live metrics from platform
    settings = _get_settings()
    live_metrics = _fetch_live_metrics(published.platform, published.platform_post_id, settings)

    # Save snapshot if we got data
    if live_metrics:
        from datetime import datetime, timezone
        snapshot = MetricSnapshot(
            workspace_id=draft.workspace_id,
            published_post_id=published.id,
            metrics=live_metrics,
        )
        db.add(snapshot)
        db.commit()

    # Fall back to stored snapshot if live fetch failed
    if not live_metrics:
        snapshot = db.scalars(
            select(MetricSnapshot)
            .where(MetricSnapshot.published_post_id == published.id)
            .order_by(MetricSnapshot.captured_at.desc())
            .limit(1)
        ).first()
        live_metrics = snapshot.metrics if snapshot else None

    return {
        "draft_id": str(draft_id),
        "published": True,
        "platform": published.platform,
        "platform_post_id": published.platform_post_id,
        "published_at": published.published_at.isoformat() if published.published_at else published.created_at.isoformat(),
        "platform_url": published.metadata_json.get("url") if published.metadata_json else None,
        "metrics": live_metrics,
    }
