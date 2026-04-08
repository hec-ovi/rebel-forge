"""
Social Inbox — fetch mentions, comments, and DMs from connected platforms.
Stores them locally. Agent can auto-reply if enabled.
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.orm import Session

import httpx

from rebel_forge_backend.api.auth import require_owner
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.db.session import get_db
from rebel_forge_backend.services.events import record_event
from rebel_forge_backend.services.workspace import WorkspaceService

logger = logging.getLogger("rebel_forge_backend.inbox")

router = APIRouter()


class InboxMessage(BaseModel):
    platform: str
    message_id: str
    author: str
    text: str
    timestamp: str
    type: str  # "mention" | "comment" | "dm"
    in_reply_to: str | None = None
    our_reply: str | None = None


class AutoReplyConfig(BaseModel):
    enabled: bool = False
    tone: str = "friendly and brief"
    max_length: int = 100


def _fetch_x_mentions(settings) -> list[dict]:
    """Fetch recent mentions from X."""
    if not settings.x_consumer_key:
        return []

    try:
        import requests
        from requests_oauthlib import OAuth1
        auth = OAuth1(settings.x_consumer_key, settings.x_consumer_secret,
                      settings.x_access_token, settings.x_access_token_secret)

        # Get user ID
        r = requests.get("https://api.twitter.com/2/users/me", auth=auth, timeout=10)
        if r.status_code != 200:
            return []
        user_id = r.json()["data"]["id"]

        # Get mentions
        r = requests.get(
            f"https://api.twitter.com/2/users/{user_id}/mentions",
            params={"max_results": 10, "tweet.fields": "created_at,author_id,text"},
            auth=auth,
            timeout=10,
        )
        if r.status_code != 200:
            logger.warning("[inbox] X mentions failed: %s", r.text[:100])
            return []

        tweets = r.json().get("data", [])
        return [
            {
                "platform": "x",
                "message_id": t["id"],
                "author": t.get("author_id", "unknown"),
                "text": t["text"],
                "timestamp": t.get("created_at", ""),
                "type": "mention",
            }
            for t in tweets
        ]
    except Exception as e:
        logger.error("[inbox] X fetch failed: %s", e)
        return []


def _fetch_facebook_comments(settings) -> list[dict]:
    """Fetch recent comments on Facebook page posts."""
    if not settings.facebook_page_token or not settings.facebook_page_id:
        return []

    try:
        with httpx.Client(timeout=15.0) as client:
            # Get recent posts
            r = client.get(
                f"https://graph.facebook.com/v23.0/{settings.facebook_page_id}/posts",
                params={"access_token": settings.facebook_page_token, "limit": 5, "fields": "id"},
            )
            if r.status_code != 200:
                return []

            posts = r.json().get("data", [])
            comments = []

            for post in posts[:3]:
                r = client.get(
                    f"https://graph.facebook.com/v23.0/{post['id']}/comments",
                    params={"access_token": settings.facebook_page_token, "limit": 5, "fields": "id,message,from,created_time"},
                )
                if r.status_code == 200:
                    for c in r.json().get("data", []):
                        comments.append({
                            "platform": "facebook",
                            "message_id": c["id"],
                            "author": c.get("from", {}).get("name", "unknown"),
                            "text": c.get("message", ""),
                            "timestamp": c.get("created_time", ""),
                            "type": "comment",
                            "in_reply_to": post["id"],
                        })

            return comments
    except Exception as e:
        logger.error("[inbox] Facebook fetch failed: %s", e)
        return []


def _fetch_instagram_comments(settings) -> list[dict]:
    """Fetch recent comments on Instagram posts."""
    if not settings.instagram_access_token or not settings.instagram_user_id:
        return []

    try:
        with httpx.Client(timeout=15.0) as client:
            # Get recent media
            r = client.get(
                f"https://graph.instagram.com/v23.0/{settings.instagram_user_id}/media",
                params={"access_token": settings.instagram_access_token, "limit": 5, "fields": "id"},
            )
            if r.status_code != 200:
                return []

            media = r.json().get("data", [])
            comments = []

            for m in media[:3]:
                r = client.get(
                    f"https://graph.instagram.com/v23.0/{m['id']}/comments",
                    params={"access_token": settings.instagram_access_token, "fields": "id,text,username,timestamp"},
                )
                if r.status_code == 200:
                    for c in r.json().get("data", []):
                        comments.append({
                            "platform": "instagram",
                            "message_id": c["id"],
                            "author": c.get("username", "unknown"),
                            "text": c.get("text", ""),
                            "timestamp": c.get("timestamp", ""),
                            "type": "comment",
                            "in_reply_to": m["id"],
                        })

            return comments
    except Exception as e:
        logger.error("[inbox] Instagram fetch failed: %s", e)
        return []


@router.get("/inbox")
def get_inbox(
    platform: str | None = None,
    limit: int = Query(default=30, le=100),
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    """Get inbox messages from all or specific platform."""
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)

    messages = []

    if platform is None or platform == "x":
        messages.extend(_fetch_x_mentions(settings))

    if platform is None or platform == "facebook":
        messages.extend(_fetch_facebook_comments(settings))

    if platform is None or platform == "instagram":
        messages.extend(_fetch_instagram_comments(settings))

    # Sort by timestamp descending
    messages.sort(key=lambda m: m.get("timestamp", ""), reverse=True)

    # Log fetch event
    record_event(
        db,
        workspace_id=workspace.id,
        entity_type="inbox",
        entity_id=workspace.id,
        event_type="inbox.fetched",
        payload={"count": len(messages), "platform": platform or "all"},
    )
    db.commit()

    return {"messages": messages[:limit], "total": len(messages)}


@router.get("/inbox/config")
def get_inbox_config(db: Session = Depends(get_db), _role: str = Depends(require_owner)):
    """Get auto-reply configuration."""
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    bp = workspace.brand_profile

    config = {}
    if bp and bp.style_notes:
        config = bp.style_notes.get("auto_reply", {})

    return AutoReplyConfig(**config) if config else AutoReplyConfig()


@router.put("/inbox/config")
def update_inbox_config(
    payload: AutoReplyConfig,
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    """Update auto-reply configuration."""
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    bp = workspace.brand_profile

    if bp:
        style = bp.style_notes or {}
        style["auto_reply"] = payload.model_dump()
        bp.style_notes = style
        db.commit()

    return payload
