from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from rebel_forge_backend.api.auth import require_owner
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.db.models import (
    ContentDraft,
    DraftStatus,
    PublishedPost,
    PublishJob,
    PublishStatus,
)
from rebel_forge_backend.db.session import get_db
from rebel_forge_backend.providers.publishers.formatting import (
    PLATFORM_CHARACTER_LIMITS,
    canonical_platform,
    format_platform_post,
)
from rebel_forge_backend.services.events import record_event
from rebel_forge_backend.services.workspace import WorkspaceService

router = APIRouter()


class PublishResponse(BaseModel):
    success: bool
    platform: str
    url: str | None = None
    error: str | None = None
    ambiguous: bool = False


def _provider_failure(result, platform: str) -> PublishResponse:
    error = result.error
    ambiguous = bool(getattr(result, "ambiguous", False))
    if result.success and not result.platform_post_id:
        error = f"{platform} reported success without a platform post ID"
        ambiguous = True
    return PublishResponse(
        success=False,
        platform=platform,
        error=error or "Publishing failed",
        ambiguous=ambiguous,
    )


def _publish_to_x(draft, settings, db):
    from rebel_forge_backend.providers.publishers.x_twitter import XPublisher

    if not settings.x_consumer_key:
        return PublishResponse(
            success=False, platform="x", error="X/Twitter credentials not configured"
        )

    publisher = XPublisher(
        consumer_key=settings.x_consumer_key,
        consumer_secret=settings.x_consumer_secret,
        access_token=settings.x_access_token,
        access_token_secret=settings.x_access_token_secret,
    )
    tweet_text = publisher.format_draft_as_tweet(draft.caption, draft.hashtags)
    result = publisher.publish_text(tweet_text)

    if result.success and result.platform_post_id:
        post = PublishedPost(
            workspace_id=draft.workspace_id,
            draft_id=draft.id,
            platform="x",
            platform_post_id=result.platform_post_id,
            metadata_json={"url": result.url, "tweet_text": tweet_text},
        )
        db.add(post)
        record_event(
            db,
            workspace_id=draft.workspace_id,
            entity_type="content_draft",
            entity_id=draft.id,
            event_type="draft.published",
            payload={"platform": "x", "url": result.url},
        )
        return PublishResponse(success=True, platform="x", url=result.url)
    return _provider_failure(result, "x")


def _publish_to_linkedin(draft, settings, db):
    from rebel_forge_backend.providers.publishers.linkedin import LinkedInPublisher

    if not settings.linkedin_access_token:
        return PublishResponse(
            success=False, platform="linkedin", error="LinkedIn credentials not configured"
        )

    publisher = LinkedInPublisher(settings.linkedin_access_token)
    post_text = publisher.format_draft_as_post(draft.caption, draft.hashtags)
    author_urn = (
        f"urn:li:person:{settings.linkedin_person_id}" if settings.linkedin_person_id else None
    )
    result = publisher.publish_text(post_text, author_urn=author_urn)

    if result.success and result.platform_post_id:
        post = PublishedPost(
            workspace_id=draft.workspace_id,
            draft_id=draft.id,
            platform="linkedin",
            platform_post_id=result.platform_post_id,
            metadata_json={"url": result.url, "post_text": post_text},
        )
        db.add(post)
        record_event(
            db,
            workspace_id=draft.workspace_id,
            entity_type="content_draft",
            entity_id=draft.id,
            event_type="draft.published",
            payload={"platform": "linkedin", "url": result.url},
        )
        return PublishResponse(success=True, platform="linkedin", url=result.url)
    return _provider_failure(result, "linkedin")


def _publish_to_facebook(draft, settings, db):
    from rebel_forge_backend.providers.publishers.facebook import FacebookPublisher

    if not settings.facebook_access_token:
        return PublishResponse(
            success=False, platform="facebook", error="Facebook credentials not configured"
        )

    publisher = FacebookPublisher(settings.facebook_access_token)
    post_text = publisher.format_post(draft.caption, draft.hashtags)
    result = publisher.publish_text(
        post_text,
        page_id=settings.facebook_page_id or None,
        page_token=settings.facebook_page_token or None,
    )

    if result.success and result.platform_post_id:
        post = PublishedPost(
            workspace_id=draft.workspace_id,
            draft_id=draft.id,
            platform="facebook",
            platform_post_id=result.platform_post_id,
            metadata_json={"url": result.url},
        )
        db.add(post)
        record_event(
            db,
            workspace_id=draft.workspace_id,
            entity_type="content_draft",
            entity_id=draft.id,
            event_type="draft.published",
            payload={"platform": "facebook", "url": result.url},
        )
        return PublishResponse(success=True, platform="facebook", url=result.url)
    return _provider_failure(result, "facebook")


def _publish_to_instagram(draft, settings, db):
    from sqlalchemy import select

    from rebel_forge_backend.db.models import Asset, AssetStatus
    from rebel_forge_backend.providers.publishers.instagram import InstagramPublisher

    if not settings.instagram_access_token or not settings.instagram_user_id:
        return PublishResponse(
            success=False, platform="instagram", error="Instagram credentials not configured"
        )

    # Find the image asset for this draft
    asset = db.scalars(
        select(Asset)
        .where(Asset.draft_id == draft.id)
        .where(Asset.status == AssetStatus.READY)
        .order_by(Asset.created_at.desc())
        .limit(1)
    ).first()

    if not asset or not (asset.public_url or asset.external_url):
        return PublishResponse(
            success=False,
            platform="instagram",
            error="No image available for this draft. Generate an image first (ComfyUI must be running).",
        )

    publisher = InstagramPublisher(settings.instagram_access_token, settings.instagram_user_id)
    caption = publisher.format_caption(draft.caption, draft.hashtags)

    # Use public_url if available (R2), otherwise try external_url
    image_url = asset.public_url or asset.external_url

    # If still a local URL, try uploading to R2
    if "127.0.0.1" in image_url or "localhost" in image_url:
        if settings.r2_endpoint_url and settings.r2_public_url:
            try:
                from rebel_forge_backend.services.cloud_storage import CloudStorage

                cloud = CloudStorage(settings)
                filename = f"{draft.id}.png"
                image_url = cloud.upload_image_from_url(image_url, filename)
                asset.public_url = image_url
                asset.metadata_json = {
                    **(asset.metadata_json or {}),
                    "r2_url": image_url,
                    "r2_object_key": cloud.object_key_for_filename(filename),
                }
                db.flush()
            except Exception as e:
                return PublishResponse(
                    success=False,
                    platform="instagram",
                    error=f"Failed to upload image to cloud: {e}",
                )
        else:
            return PublishResponse(
                success=False,
                platform="instagram",
                error="Image is local and no cloud storage configured. Set up Cloudflare R2.",
            )

    result = publisher.publish_image_post(image_url, caption)

    if result.success and result.platform_post_id:
        post = PublishedPost(
            workspace_id=draft.workspace_id,
            draft_id=draft.id,
            platform="instagram",
            platform_post_id=result.platform_post_id,
            metadata_json={"url": result.url},
        )
        db.add(post)
        record_event(
            db,
            workspace_id=draft.workspace_id,
            entity_type="content_draft",
            entity_id=draft.id,
            event_type="draft.published",
            payload={"platform": "instagram", "url": result.url},
        )
        return PublishResponse(success=True, platform="instagram", url=result.url)
    return _provider_failure(result, "instagram")


def _publish_to_threads(draft, settings, db):
    from rebel_forge_backend.providers.publishers.threads import ThreadsPublisher

    if not settings.threads_access_token or not settings.threads_user_id:
        return PublishResponse(
            success=False, platform="threads", error="Threads credentials not configured"
        )

    publisher = ThreadsPublisher(settings.threads_access_token, settings.threads_user_id)
    post_text = publisher.format_post(draft.caption, draft.hashtags)
    result = publisher.publish_text(post_text)

    if result.success and result.platform_post_id:
        post = PublishedPost(
            workspace_id=draft.workspace_id,
            draft_id=draft.id,
            platform="threads",
            platform_post_id=result.platform_post_id,
            metadata_json={"url": result.url},
        )
        db.add(post)
        record_event(
            db,
            workspace_id=draft.workspace_id,
            entity_type="content_draft",
            entity_id=draft.id,
            event_type="draft.published",
            payload={"platform": "threads", "url": result.url},
        )
        return PublishResponse(success=True, platform="threads", url=result.url)
    return _provider_failure(result, "threads")


PUBLISHERS = {
    "x": _publish_to_x,
    "twitter": _publish_to_x,
    "linkedin": _publish_to_linkedin,
    "facebook": _publish_to_facebook,
    "fb": _publish_to_facebook,
    "instagram": _publish_to_instagram,
    "ig": _publish_to_instagram,
    "threads": _publish_to_threads,
}


@router.post("/drafts/{draft_id}/publish", response_model=PublishResponse)
def publish_draft(
    draft_id: UUID,
    platform: str | None = Query(
        default=None,
        description="Target platform. Defaults to the platform the draft was created for.",
    ),
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    draft = db.scalar(
        select(ContentDraft)
        .where(ContentDraft.workspace_id == workspace.id, ContentDraft.id == draft_id)
        .with_for_update()
    )
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")

    if draft.status != DraftStatus.APPROVED:
        raise HTTPException(status_code=409, detail="Only approved drafts can be published")

    target = canonical_platform(platform or draft.platform)
    draft_platform = canonical_platform(draft.platform)
    if target != draft_platform:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Draft was created for '{draft_platform}' and cannot be published to '{target}'."
            ),
        )

    try:
        format_platform_post(target, draft.caption, draft.hashtags)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    publish_fn = PUBLISHERS.get(target)

    if not publish_fn:
        supported = ", ".join(PLATFORM_CHARACTER_LIMITS)
        raise HTTPException(
            status_code=400, detail=f"Platform '{target}' not supported. Available: {supported}"
        )

    if db.scalar(select(PublishedPost.id).where(PublishedPost.draft_id == draft.id)) is not None:
        raise HTTPException(status_code=409, detail="Draft already has a publication record")

    publish_job = db.scalar(
        select(PublishJob).where(PublishJob.draft_id == draft.id).with_for_update()
    )
    if publish_job and publish_job.status in (
        PublishStatus.PENDING,
        PublishStatus.SENT,
        PublishStatus.PUBLISHED,
    ):
        raise HTTPException(status_code=409, detail="Draft publication is already in progress or complete")
    if publish_job is None:
        publish_job = PublishJob(
            workspace_id=workspace.id,
            draft_id=draft.id,
            platform=target,
        )
        db.add(publish_job)
    publish_job.platform = target
    # SENT means the provider boundary is about to be crossed. If the request
    # times out, its outcome is ambiguous and the job must not be retried blindly.
    publish_job.status = PublishStatus.SENT
    publish_job.request_payload = {"draft_id": str(draft.id), "platform": target}
    publish_job.response_payload = None
    publish_job.error_message = None
    db.commit()

    try:
        result = publish_fn(draft, settings, db)
    except Exception as exc:
        db.rollback()
        publish_job = db.get(PublishJob, publish_job.id)
        publish_job.status = PublishStatus.SENT
        publish_job.error_message = str(exc)
        db.commit()
        raise HTTPException(status_code=502, detail=f"Publishing provider failed: {exc}") from exc

    if result.success:
        draft.status = DraftStatus.PUBLISHED
        publish_job.status = PublishStatus.PUBLISHED
        publish_job.response_payload = {"url": result.url}
    else:
        publish_job.status = PublishStatus.SENT if result.ambiguous else PublishStatus.FAILED
        publish_job.error_message = result.error
    db.commit()

    return result
