import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from rebel_forge_backend.api.auth import require_owner, require_viewer
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.core.integrations import META_GRAPH_API_VERSION, X_API_BASE
from rebel_forge_backend.db.models import (
    Asset,
    ContentDraft,
    Correction,
    DraftStatus,
    JobType,
    MetricSnapshot,
    PublishedPost,
    PublishJob,
)
from rebel_forge_backend.db.session import get_db
from rebel_forge_backend.providers.publishers.formatting import format_platform_post
from rebel_forge_backend.schemas.drafts import DraftGenerationRequest, DraftRead, DraftUpdateRequest
from rebel_forge_backend.schemas.jobs import JobRead
from rebel_forge_backend.services.draft_query import get_workspace_draft
from rebel_forge_backend.services.events import record_event
from rebel_forge_backend.services.jobs import JobService
from rebel_forge_backend.services.storage import LocalAssetStorage
from rebel_forge_backend.services.workspace import WorkspaceService

_logger = logging.getLogger("rebel_forge_backend.drafts")


def _get_primary_workspace_draft(db: Session, draft_id: object) -> ContentDraft | None:
    workspace = WorkspaceService(get_settings()).get_or_create_primary_workspace(db)
    return get_workspace_draft(db, workspace_id=workspace.id, draft_id=draft_id)


def _fetch_live_metrics(platform: str, post_id: str, settings) -> dict | None:
    """Fetch live engagement metrics from platform API. Returns None on failure."""
    try:
        if platform == "x":
            import requests
            from requests_oauthlib import OAuth1

            auth = OAuth1(
                settings.x_consumer_key,
                settings.x_consumer_secret,
                settings.x_access_token,
                settings.x_access_token_secret,
            )
            r = requests.get(
                f"{X_API_BASE}/tweets/{post_id}",
                params={"tweet.fields": "public_metrics,created_at"},
                auth=auth,
                timeout=10,
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
                f"https://graph.facebook.com/{META_GRAPH_API_VERSION}/{post_id}",
                params={
                    "fields": "likes.summary(true),comments.summary(true),shares",
                    "access_token": settings.facebook_page_token,
                },
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
                f"https://graph.instagram.com/{META_GRAPH_API_VERSION}/{post_id}",
                params={
                    "fields": "like_count,comments_count",
                    "access_token": settings.instagram_access_token,
                },
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
        .order_by(Asset.created_at.desc())
    ).all()
    image_map = {}
    for a in assets:
        if a.draft_id and a.draft_id not in image_map:
            image_map[a.draft_id] = a.public_url or a.external_url

    pubs = db.scalars(select(PublishedPost).where(PublishedPost.draft_id.in_(draft_ids))).all()
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

    draft = _get_primary_workspace_draft(db, draft_id)
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
    result["published_url"] = (
        ((pub.metadata_json or {}).get("url") or (pub.metadata_json or {}).get("platform_url"))
        if pub
        else None
    )
    result["published_at"] = (pub.published_at or pub.created_at).isoformat() if pub else None
    result["platform_post_id"] = pub.platform_post_id if pub else None

    return result


@router.post("/drafts/generate", response_model=JobRead)
def generate_drafts(
    payload: DraftGenerationRequest,
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
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
    caption: str | None = Field(default=None, min_length=1)

    @field_validator("caption")
    @classmethod
    def strip_caption(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Caption cannot be blank")
        return value


@router.post("/drafts/{draft_id}/approve", response_model=DraftRead)
def approve_draft(
    draft_id: UUID,
    payload: DraftApproveRequest | None = None,
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
) -> DraftRead:
    draft = _get_primary_workspace_draft(db, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    if draft.status != DraftStatus.DRAFT.value and draft.status != DraftStatus.REVIEWED.value:
        raise HTTPException(
            status_code=400, detail=f"Cannot approve draft in status '{draft.status}'"
        )

    had_edits = (
        payload is not None and payload.caption is not None and payload.caption != draft.caption
    )
    original_caption = draft.caption

    if had_edits:
        draft.caption = payload.caption

    try:
        format_platform_post(draft.platform, draft.caption, draft.hashtags)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    draft.status = DraftStatus.APPROVED

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

        store_correction(
            db=db,
            workspace_id=draft.workspace_id,
            draft_id=draft.id,
            original_text=original_caption,
            corrected_text=payload.caption,
            context={"platform": draft.platform, "concept": draft.concept},
        )

    db.commit()
    db.refresh(draft)

    return DraftRead.model_validate(draft)


@router.put("/drafts/{draft_id}")
def update_draft(
    draft_id: UUID,
    payload: DraftUpdateRequest,
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    """Update a draft's content. Reverts approved drafts back to draft status."""
    draft = _get_primary_workspace_draft(db, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    if draft.status in (DraftStatus.PUBLISHED, DraftStatus.SCHEDULED):
        raise HTTPException(status_code=409, detail=f"Cannot edit {draft.status} content")

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(draft, field, value)

    draft.status = DraftStatus.DRAFT

    db.commit()
    db.refresh(draft)
    return DraftRead.model_validate(draft)


@router.delete("/drafts/{draft_id}")
def delete_draft(
    draft_id: UUID, db: Session = Depends(get_db), _role: str = Depends(require_owner)
):
    """Permanently delete a draft and its assets."""
    draft = _get_primary_workspace_draft(db, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    if draft.status == DraftStatus.PUBLISHED:
        raise HTTPException(
            status_code=409,
            detail="Published drafts cannot be deleted because their external audit record must remain",
        )

    workspace_id = draft.workspace_id
    assets = db.scalars(select(Asset).where(Asset.draft_id == draft_id)).all()
    local_paths = [asset.storage_path for asset in assets if asset.storage_path]
    r2_keys = [
        (asset.metadata_json or {}).get("r2_object_key")
        for asset in assets
        if (asset.metadata_json or {}).get("r2_object_key")
    ]
    published_ids = select(PublishedPost.id).where(PublishedPost.draft_id == draft_id)
    db.execute(delete(MetricSnapshot).where(MetricSnapshot.published_post_id.in_(published_ids)))
    db.execute(delete(PublishedPost).where(PublishedPost.draft_id == draft_id))
    db.execute(delete(PublishJob).where(PublishJob.draft_id == draft_id))
    db.execute(delete(Asset).where(Asset.draft_id == draft_id))
    db.execute(delete(Correction).where(Correction.draft_id == draft_id))

    record_event(
        db,
        workspace_id=workspace_id,
        entity_type="content_draft",
        entity_id=draft_id,
        event_type="draft.deleted",
        payload={},
    )
    db.delete(draft)
    db.commit()

    settings = get_settings()
    local_storage = LocalAssetStorage(settings)
    for storage_path in local_paths:
        try:
            local_storage.delete(storage_path)
        except Exception as exc:
            _logger.warning("Failed to remove local asset %s: %s", storage_path, exc)

    if r2_keys and all(
        (
            settings.r2_endpoint_url,
            settings.r2_access_key_id,
            settings.r2_secret_access_key,
            settings.r2_bucket_name,
        )
    ):
        try:
            from rebel_forge_backend.services.cloud_storage import CloudStorage

            cloud = CloudStorage(settings)
            for key in r2_keys:
                cloud.delete_key(key)
        except Exception as exc:
            _logger.warning("Failed to remove one or more R2 assets for draft %s: %s", draft_id, exc)

    return {"status": "deleted", "id": str(draft_id)}


@router.post("/drafts/{draft_id}/reject", response_model=DraftRead)
def reject_draft(
    draft_id: UUID, db: Session = Depends(get_db), _role: str = Depends(require_owner)
) -> DraftRead:
    draft = _get_primary_workspace_draft(db, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    if draft.status not in (DraftStatus.DRAFT, DraftStatus.REVIEWED, DraftStatus.APPROVED):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot reject draft in status '{draft.status}'",
        )

    draft.status = DraftStatus.FAILED
    record_event(
        db,
        workspace_id=draft.workspace_id,
        entity_type="content_draft",
        entity_id=draft.id,
        event_type="draft.rejected",
        payload={},
    )
    db.commit()
    db.refresh(draft)

    return DraftRead.model_validate(draft)


@router.get("/drafts/{draft_id}/engagement")
def get_draft_engagement(
    draft_id: UUID, db: Session = Depends(get_db), _role: str = Depends(require_viewer)
):
    """Get engagement metrics for a published draft. Fetches live from platform API."""
    from rebel_forge_backend.core.config import get_settings as _get_settings
    from rebel_forge_backend.db.models import MetricSnapshot, PublishedPost

    draft = _get_primary_workspace_draft(db, draft_id)
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
        "published_at": published.published_at.isoformat()
        if published.published_at
        else published.created_at.isoformat(),
        "platform_url": published.metadata_json.get("url") if published.metadata_json else None,
        "metrics": live_metrics,
    }
