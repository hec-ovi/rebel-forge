from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from rebel_forge_backend.api.auth import require_owner
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.db.models import ContentDraft, DraftStatus, PublishedPost
from rebel_forge_backend.db.session import get_db
from rebel_forge_backend.services.events import record_event

router = APIRouter()


class PublishResponse(BaseModel):
    success: bool
    platform: str
    url: str | None = None
    error: str | None = None


def _publish_to_x(draft, settings, db):
    from rebel_forge_backend.providers.publishers.x_twitter import XPublisher

    if not settings.x_consumer_key:
        return PublishResponse(success=False, platform="x", error="X/Twitter credentials not configured")

    publisher = XPublisher(
        consumer_key=settings.x_consumer_key,
        consumer_secret=settings.x_consumer_secret,
        access_token=settings.x_access_token,
        access_token_secret=settings.x_access_token_secret,
    )
    tweet_text = publisher.format_draft_as_tweet(draft.caption, draft.hashtags)
    result = publisher.publish_text(tweet_text)

    if result.success:
        post = PublishedPost(
            workspace_id=draft.workspace_id,
            draft_id=draft.id,
            platform="x",
            platform_post_id=result.platform_post_id,
            metadata_json={"url": result.url, "tweet_text": tweet_text},
        )
        db.add(post)
        record_event(db, workspace_id=draft.workspace_id, entity_type="content_draft",
                     entity_id=draft.id, event_type="draft.published",
                     payload={"platform": "x", "url": result.url})
        return PublishResponse(success=True, platform="x", url=result.url)
    return PublishResponse(success=False, platform="x", error=result.error)


def _publish_to_linkedin(draft, settings, db):
    from rebel_forge_backend.providers.publishers.linkedin import LinkedInPublisher

    if not settings.linkedin_access_token:
        return PublishResponse(success=False, platform="linkedin", error="LinkedIn credentials not configured")

    publisher = LinkedInPublisher(settings.linkedin_access_token)
    post_text = publisher.format_draft_as_post(draft.caption, draft.hashtags)
    author_urn = f"urn:li:person:{settings.linkedin_person_id}" if settings.linkedin_person_id else None
    result = publisher.publish_text(post_text, author_urn=author_urn)

    if result.success:
        post = PublishedPost(
            workspace_id=draft.workspace_id,
            draft_id=draft.id,
            platform="linkedin",
            platform_post_id=result.platform_post_id,
            metadata_json={"url": result.url, "post_text": post_text},
        )
        db.add(post)
        record_event(db, workspace_id=draft.workspace_id, entity_type="content_draft",
                     entity_id=draft.id, event_type="draft.published",
                     payload={"platform": "linkedin", "url": result.url})
        return PublishResponse(success=True, platform="linkedin", url=result.url)
    return PublishResponse(success=False, platform="linkedin", error=result.error)


def _publish_to_facebook(draft, settings, db):
    from rebel_forge_backend.providers.publishers.facebook import FacebookPublisher

    if not settings.facebook_access_token:
        return PublishResponse(success=False, platform="facebook", error="Facebook credentials not configured")

    publisher = FacebookPublisher(settings.facebook_access_token)
    post_text = publisher.format_post(draft.caption, draft.hashtags)
    result = publisher.publish_text(
        post_text,
        page_id=settings.facebook_page_id or None,
        page_token=settings.facebook_page_token or None,
    )

    if result.success:
        post = PublishedPost(
            workspace_id=draft.workspace_id, draft_id=draft.id, platform="facebook",
            platform_post_id=result.platform_post_id, metadata_json={"url": result.url},
        )
        db.add(post)
        record_event(db, workspace_id=draft.workspace_id, entity_type="content_draft",
                     entity_id=draft.id, event_type="draft.published",
                     payload={"platform": "facebook", "url": result.url})
        return PublishResponse(success=True, platform="facebook", url=result.url)
    return PublishResponse(success=False, platform="facebook", error=result.error)


def _publish_to_instagram(draft, settings, db):
    from sqlalchemy import select
    from rebel_forge_backend.db.models import Asset, AssetStatus
    from rebel_forge_backend.providers.publishers.instagram import InstagramPublisher

    if not settings.instagram_access_token or not settings.instagram_user_id:
        return PublishResponse(success=False, platform="instagram", error="Instagram credentials not configured")

    # Find the image asset for this draft
    asset = db.scalars(
        select(Asset)
        .where(Asset.draft_id == draft.id)
        .where(Asset.status == AssetStatus.READY)
        .order_by(Asset.created_at.desc())
        .limit(1)
    ).first()

    if not asset or not asset.external_url:
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
                image_url = cloud.upload_image_from_url(image_url, f"{draft.id}.png")
                asset.public_url = image_url
                db.commit()
            except Exception as e:
                return PublishResponse(success=False, platform="instagram",
                                       error=f"Failed to upload image to cloud: {e}")
        else:
            return PublishResponse(success=False, platform="instagram",
                                   error="Image is local and no cloud storage configured. Set up Cloudflare R2.")

    result = publisher.publish_image_post(image_url, caption)

    if result.success:
        post = PublishedPost(
            workspace_id=draft.workspace_id, draft_id=draft.id, platform="instagram",
            platform_post_id=result.platform_post_id, metadata_json={"url": result.url},
        )
        db.add(post)
        record_event(db, workspace_id=draft.workspace_id, entity_type="content_draft",
                     entity_id=draft.id, event_type="draft.published",
                     payload={"platform": "instagram", "url": result.url})
        return PublishResponse(success=True, platform="instagram", url=result.url)
    return PublishResponse(success=False, platform="instagram", error=result.error)


def _publish_to_threads(draft, settings, db):
    from rebel_forge_backend.providers.publishers.threads import ThreadsPublisher

    if not settings.threads_access_token or not settings.threads_user_id:
        return PublishResponse(success=False, platform="threads", error="Threads credentials not configured")

    publisher = ThreadsPublisher(settings.threads_access_token, settings.threads_user_id)
    post_text = publisher.format_post(draft.caption, draft.hashtags)
    result = publisher.publish_text(post_text)

    if result.success:
        post = PublishedPost(
            workspace_id=draft.workspace_id, draft_id=draft.id, platform="threads",
            platform_post_id=result.platform_post_id, metadata_json={"url": result.url},
        )
        db.add(post)
        record_event(db, workspace_id=draft.workspace_id, entity_type="content_draft",
                     entity_id=draft.id, event_type="draft.published",
                     payload={"platform": "threads", "url": result.url})
        return PublishResponse(success=True, platform="threads", url=result.url)
    return PublishResponse(success=False, platform="threads", error=result.error)


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
    platform: str = Query(default="x", description="Target platform: x, linkedin, facebook, instagram"),
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    settings = get_settings()
    draft = db.get(ContentDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")

    target = platform.lower()
    publish_fn = PUBLISHERS.get(target)

    if not publish_fn:
        supported = ", ".join(PUBLISHERS.keys())
        raise HTTPException(status_code=400, detail=f"Platform '{target}' not supported. Available: {supported}")

    result = publish_fn(draft, settings, db)

    if result.success:
        draft.status = DraftStatus.PUBLISHED
        db.commit()

    return result
