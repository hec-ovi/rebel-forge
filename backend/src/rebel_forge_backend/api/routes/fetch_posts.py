"""
Fetch posts from connected social platforms — for training on past content.
Returns posts with text + engagement metrics from X, Facebook, Instagram, Threads.
"""
import logging
import hmac
import hashlib
import base64
import time
import uuid as _uuid
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from rebel_forge_backend.api.auth import require_owner
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.db.session import get_db

logger = logging.getLogger("rebel_forge_backend.fetch_posts")

router = APIRouter()


def _x_oauth_header(method: str, url: str, params: dict, settings) -> str:
    """Build OAuth 1.0a header for X API."""
    oauth_params = {
        "oauth_consumer_key": settings.x_consumer_key,
        "oauth_nonce": _uuid.uuid4().hex,
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": str(int(time.time())),
        "oauth_token": settings.x_access_token,
        "oauth_version": "1.0",
    }
    all_params = {**oauth_params, **params}
    param_str = "&".join(f"{quote(k, safe='')}={quote(str(v), safe='')}" for k, v in sorted(all_params.items()))
    base_string = f"{method.upper()}&{quote(url, safe='')}&{quote(param_str, safe='')}"
    signing_key = f"{quote(settings.x_consumer_secret, safe='')}&{quote(settings.x_access_token_secret, safe='')}"
    signature = base64.b64encode(hmac.new(signing_key.encode(), base_string.encode(), hashlib.sha1).digest()).decode()
    oauth_params["oauth_signature"] = signature
    return "OAuth " + ", ".join(f'{quote(k, safe="")}="{quote(v, safe="")}"' for k, v in sorted(oauth_params.items()))


@router.get("/fetch-posts/{platform}")
def fetch_posts(
    platform: str,
    limit: int = 50,
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    """Fetch posts from a platform with engagement metrics."""
    settings = get_settings()

    try:
        if platform == "x":
            return _fetch_x(settings, limit)
        elif platform == "facebook":
            return _fetch_facebook(settings, limit)
        elif platform == "instagram":
            return _fetch_instagram(settings, limit)
        elif platform == "threads":
            return _fetch_threads(settings, limit)
        elif platform == "linkedin":
            return {"posts": [], "error": "LinkedIn requires Community Management API approval. Not available yet."}
        else:
            return {"posts": [], "error": f"Unknown platform: {platform}"}
    except Exception as e:
        logger.error("[fetch_posts] %s failed: %s", platform, e)
        return {"posts": [], "error": str(e)}


@router.get("/fetch-posts")
def fetch_all_posts(
    limit: int = 20,
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    """Fetch posts from ALL connected platforms."""
    settings = get_settings()
    all_posts = []
    errors = {}

    for platform, fetcher, check in [
        ("x", _fetch_x, bool(settings.x_consumer_key and settings.x_access_token)),
        ("facebook", _fetch_facebook, bool(settings.facebook_page_token)),
        ("instagram", _fetch_instagram, bool(settings.instagram_access_token)),
        ("threads", _fetch_threads, bool(settings.threads_access_token)),
    ]:
        if not check:
            continue
        try:
            result = fetcher(settings, limit)
            all_posts.extend(result.get("posts", []))
        except Exception as e:
            errors[platform] = str(e)
            logger.error("[fetch_posts] %s failed: %s", platform, e)

    # Sort by date, newest first
    all_posts.sort(key=lambda p: p.get("created_at", ""), reverse=True)

    return {"posts": all_posts[:limit * 4], "total": len(all_posts), "errors": errors}


def _fetch_x(settings, limit: int) -> dict:
    """Fetch tweets with public metrics."""
    if not settings.x_consumer_key or not settings.x_access_token:
        return {"posts": [], "error": "X credentials not configured"}

    # Get user ID first
    me_url = "https://api.x.com/2/users/me"
    me_params = {"user.fields": "id"}
    auth = _x_oauth_header("GET", me_url, me_params, settings)
    r = httpx.get(me_url, params=me_params, headers={"Authorization": auth}, timeout=10.0)
    if r.status_code != 200:
        return {"posts": [], "error": f"X API error: {r.status_code}"}
    user_id = r.json()["data"]["id"]

    # Fetch tweets
    tweets_url = f"https://api.x.com/2/users/{user_id}/tweets"
    params = {
        "tweet.fields": "public_metrics,created_at,text",
        "max_results": str(max(min(limit, 100), 5)),
    }
    auth = _x_oauth_header("GET", tweets_url, params, settings)
    r = httpx.get(tweets_url, params=params, headers={"Authorization": auth}, timeout=10.0)
    if r.status_code != 200:
        return {"posts": [], "error": f"X API error: {r.status_code} — {r.text[:100]}"}

    data = r.json().get("data", [])
    posts = []
    for t in data:
        m = t.get("public_metrics", {})
        posts.append({
            "platform": "x",
            "platform_id": t["id"],
            "text": t.get("text", ""),
            "created_at": t.get("created_at", ""),
            "metrics": {
                "impressions": m.get("impression_count", 0),
                "likes": m.get("like_count", 0),
                "replies": m.get("reply_count", 0),
                "retweets": m.get("retweet_count", 0),
                "quotes": m.get("quote_count", 0),
                "bookmarks": m.get("bookmark_count", 0),
            },
        })

    return {"posts": posts, "total": len(posts)}


def _fetch_facebook(settings, limit: int) -> dict:
    """Fetch Facebook page posts with engagement."""
    if not settings.facebook_page_token:
        return {"posts": [], "error": "Facebook credentials not configured"}

    r = httpx.get(
        f"https://graph.facebook.com/v19.0/{settings.facebook_page_id}/posts",
        params={
            "fields": "id,message,created_time,likes.summary(true),comments.summary(true),shares",
            "limit": min(limit, 100),
            "access_token": settings.facebook_page_token,
        },
        timeout=10.0,
    )
    if r.status_code != 200:
        return {"posts": [], "error": f"Facebook API error: {r.status_code} — {r.text[:100]}"}

    data = r.json().get("data", [])
    posts = []
    for p in data:
        posts.append({
            "platform": "facebook",
            "platform_id": p["id"],
            "text": p.get("message", ""),
            "created_at": p.get("created_time", ""),
            "metrics": {
                "likes": p.get("likes", {}).get("summary", {}).get("total_count", 0),
                "comments": p.get("comments", {}).get("summary", {}).get("total_count", 0),
                "shares": p.get("shares", {}).get("count", 0) if p.get("shares") else 0,
            },
        })

    return {"posts": posts, "total": len(posts)}


def _fetch_instagram(settings, limit: int) -> dict:
    """Fetch Instagram media with engagement."""
    if not settings.instagram_access_token:
        return {"posts": [], "error": "Instagram credentials not configured"}

    r = httpx.get(
        f"https://graph.instagram.com/v19.0/{settings.instagram_user_id}/media",
        params={
            "fields": "id,caption,media_type,timestamp,like_count,comments_count,permalink",
            "limit": min(limit, 100),
            "access_token": settings.instagram_access_token,
        },
        timeout=10.0,
    )
    if r.status_code != 200:
        return {"posts": [], "error": f"Instagram API error: {r.status_code} — {r.text[:100]}"}

    data = r.json().get("data", [])
    posts = []
    for p in data:
        posts.append({
            "platform": "instagram",
            "platform_id": p["id"],
            "text": p.get("caption", ""),
            "created_at": p.get("timestamp", ""),
            "media_type": p.get("media_type", ""),
            "permalink": p.get("permalink", ""),
            "metrics": {
                "likes": p.get("like_count", 0),
                "comments": p.get("comments_count", 0),
            },
        })

    return {"posts": posts, "total": len(posts)}


def _fetch_threads(settings, limit: int) -> dict:
    """Fetch Threads posts with engagement (requires per-post insight calls)."""
    if not settings.threads_access_token:
        return {"posts": [], "error": "Threads credentials not configured"}

    # Fetch thread list
    r = httpx.get(
        f"https://graph.threads.net/v1.0/{settings.threads_user_id}/threads",
        params={
            "fields": "id,text,timestamp,permalink,media_type",
            "limit": min(limit, 50),
            "access_token": settings.threads_access_token,
        },
        timeout=10.0,
    )
    if r.status_code != 200:
        return {"posts": [], "error": f"Threads API error: {r.status_code} — {r.text[:100]}"}

    data = r.json().get("data", [])
    posts = []

    # Fetch metrics per thread (N+1 but necessary)
    for t in data:
        metrics = {}
        try:
            mr = httpx.get(
                f"https://graph.threads.net/v1.0/{t['id']}/insights",
                params={
                    "metric": "views,likes,replies,reposts,quotes",
                    "access_token": settings.threads_access_token,
                },
                timeout=5.0,
            )
            if mr.status_code == 200:
                for m in mr.json().get("data", []):
                    metrics[m["name"]] = m.get("values", [{}])[0].get("value", 0)
        except Exception:
            pass

        posts.append({
            "platform": "threads",
            "platform_id": t["id"],
            "text": t.get("text", ""),
            "created_at": t.get("timestamp", ""),
            "permalink": t.get("permalink", ""),
            "metrics": {
                "views": metrics.get("views", 0),
                "likes": metrics.get("likes", 0),
                "replies": metrics.get("replies", 0),
                "reposts": metrics.get("reposts", 0),
                "quotes": metrics.get("quotes", 0),
            },
        })

    return {"posts": posts, "total": len(posts)}
