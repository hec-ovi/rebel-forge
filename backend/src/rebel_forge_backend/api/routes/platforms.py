"""
Platform profiles — fetch live profile data from APIs, show editable fields.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import httpx

from rebel_forge_backend.api.auth import require_owner
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.db.session import get_db
from rebel_forge_backend.services.workspace import WorkspaceService

logger = logging.getLogger("rebel_forge_backend.platforms")

router = APIRouter()


class PlatformProfile(BaseModel):
    display_name: str = ""
    handle: str = ""
    bio: str = ""
    topics: str = ""
    auto_images: bool = False


# What each platform API can actually do (verified against official docs)
PLATFORM_CAPABILITIES = {
    "x": {
        "can_read": ["name", "username", "description", "profile_image_url", "location", "url", "pinned_tweet_id", "followers_count", "following_count", "tweet_count", "created_at"],
        "can_edit": [],  # X API v2 has no profile update endpoint. v1.1 update_profile is deprecated.
        "editable_labels": {},
        "edit_url": "https://x.com/settings/profile",  # Manual edit link
    },
    "linkedin": {
        "can_read": ["name", "given_name", "family_name", "picture", "locale"],
        "can_edit": [],  # w_member_social scope only allows posting, not profile editing
        "editable_labels": {},
        "edit_url": "https://www.linkedin.com/me/",  # Redirects logged-in user to their own profile
    },
    "facebook": {
        "can_read": ["name", "about", "description", "category", "fan_count", "picture", "website", "link"],
        "can_edit": ["about"],  # POST /{page-id}?about=... — limited to 100 chars
        "editable_labels": {"about": "Description (100 chars max)"},
        "edit_url": None,  # Can edit via API
    },
    "instagram": {
        "can_read": ["username", "name", "biography", "profile_picture_url", "followers_count", "media_count"],
        "can_edit": [],  # Instagram Graph API does not support profile editing
        "editable_labels": {},
        "edit_url": "https://www.instagram.com/accounts/edit/",
    },
    "threads": {
        "can_read": ["username", "name"],
        "can_edit": [],  # Threads API does not support profile editing
        "editable_labels": {},
        "edit_url": "https://www.threads.net/settings",
    },
}


def _fetch_x_profile(settings) -> dict:
    import requests
    from requests_oauthlib import OAuth1
    auth = OAuth1(settings.x_consumer_key, settings.x_consumer_secret,
                  settings.x_access_token, settings.x_access_token_secret)
    r = requests.get("https://api.twitter.com/2/users/me",
                      params={"user.fields": "name,username,description,profile_image_url,location,url,public_metrics,pinned_tweet_id,created_at"},
                      auth=auth, timeout=10)
    if r.status_code == 200:
        data = r.json().get("data", {})
        metrics = data.get("public_metrics", {})
        return {
            "display_name": data.get("name", ""),
            "handle": f"@{data.get('username', '')}",
            "bio": data.get("description", ""),
            "profile_image_url": data.get("profile_image_url", ""),
            "username": data.get("username", ""),
            "location": data.get("location", ""),
            "url": data.get("url", ""),
            "pinned_tweet_id": data.get("pinned_tweet_id", ""),
            "created_at": data.get("created_at", ""),
            "followers_count": metrics.get("followers_count", 0),
            "following_count": metrics.get("following_count", 0),
            "tweet_count": metrics.get("tweet_count", 0),
            "profile_url": f"https://x.com/{data.get('username', '')}",
        }
    return {}


def _fetch_linkedin_profile(settings) -> dict:
    r = httpx.get("https://api.linkedin.com/v2/userinfo",
                   headers={"Authorization": f"Bearer {settings.linkedin_access_token}"}, timeout=10.0)
    if r.status_code == 200:
        data = r.json()
        return {
            "display_name": data.get("name", ""),
            "handle": data.get("sub", ""),
            "first_name": data.get("given_name", ""),
            "last_name": data.get("family_name", ""),
            "profile_image_url": data.get("picture", ""),
            "locale": data.get("locale", {}).get("language", ""),
            "profile_url": "https://www.linkedin.com/me/",
        }
    return {}


def _fetch_facebook_profile(settings) -> dict:
    r = httpx.get("https://graph.facebook.com/v23.0/me/accounts",
                   params={"access_token": settings.facebook_access_token,
                           "fields": "name,about,category,description,fan_count,picture,website,link"},
                   timeout=10.0)
    if r.status_code == 200:
        pages = r.json().get("data", [])
        if pages:
            page = pages[0]
            pic = page.get("picture", {}).get("data", {}).get("url", "")
            return {
                "display_name": page.get("name", ""),
                "handle": page.get("id", ""),
                "bio": page.get("about", ""),
                "description": page.get("description", ""),
                "category": page.get("category", ""),
                "fan_count": page.get("fan_count", 0),
                "profile_image_url": pic,
                "website": page.get("website", ""),
                "link": page.get("link", ""),
            }
    return {}


def _fetch_instagram_profile(settings) -> dict:
    r = httpx.get(f"https://graph.instagram.com/v23.0/{settings.instagram_user_id}",
                   params={"fields": "id,username,name,biography,profile_picture_url,followers_count,media_count",
                           "access_token": settings.instagram_access_token},
                   timeout=10.0)
    if r.status_code == 200:
        data = r.json()
        return {
            "display_name": data.get("name", ""),
            "handle": f"@{data.get('username', '')}",
            "bio": data.get("biography", ""),
            "profile_image_url": data.get("profile_picture_url", ""),
            "followers_count": data.get("followers_count", 0),
            "media_count": data.get("media_count", 0),
            "profile_url": f"https://www.instagram.com/{data.get('username', '')}/",
        }
    return {}


def _fetch_threads_profile(settings) -> dict:
    r = httpx.get("https://graph.threads.net/v1.0/me",
                   params={"fields": "id,username,name", "access_token": settings.threads_access_token},
                   timeout=10.0)
    if r.status_code == 200:
        data = r.json()
        username = data.get("username", "")
        return {
            "display_name": data.get("name", ""),
            "handle": f"@{username}",
            "profile_url": f"https://www.threads.net/@{username}" if username else "",
        }
    return {}


PROFILE_FETCHERS = {
    "x": _fetch_x_profile,
    "linkedin": _fetch_linkedin_profile,
    "facebook": _fetch_facebook_profile,
    "instagram": _fetch_instagram_profile,
    "threads": _fetch_threads_profile,
}


@router.get("/workspace/platform-profile/{platform_id}")
def get_platform_profile(platform_id: str, db: Session = Depends(get_db), _role: str = Depends(require_owner)):
    """Get platform profile — fetches live data from API + saved local data."""
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    bp = workspace.brand_profile

    # Get saved profile data
    saved_profile = {}
    if bp and bp.style_notes:
        saved_profile = bp.style_notes.get("platform_profiles", {}).get(platform_id, {})

    # Fetch live profile from platform API
    live_profile = {}
    fetcher = PROFILE_FETCHERS.get(platform_id)
    if fetcher:
        try:
            live_profile = fetcher(settings)
        except Exception as e:
            logger.warning("[platforms] Failed to fetch %s profile: %s", platform_id, e)

    # Get capabilities
    caps = PLATFORM_CAPABILITIES.get(platform_id, {"can_read": [], "can_edit": [], "editable_labels": {}})

    # Override edit_url with saved profile URL if available
    saved_url = saved_profile.get("profile_url", "")
    if saved_url:
        caps = {**caps, "edit_url": saved_url}

    return {
        "platform": platform_id,
        "live": live_profile,
        "saved": saved_profile,
        "editable_fields": caps["can_edit"],
        "editable_labels": caps["editable_labels"],
        "read_only_fields": [f for f in caps["can_read"] if f not in caps["can_edit"]],
        "edit_url": caps.get("edit_url"),  # Link to edit profile manually if API doesn't support it
    }


@router.put("/workspace/platform-profile/{platform_id}")
def update_platform_profile(
    platform_id: str,
    payload: PlatformProfile,
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    """Save platform profile data locally."""
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    bp = workspace.brand_profile

    if not bp:
        raise HTTPException(status_code=400, detail="No brand profile found")

    style = bp.style_notes or {}
    profiles = style.get("platform_profiles", {})
    profiles[platform_id] = payload.model_dump()
    style["platform_profiles"] = profiles
    bp.style_notes = style
    db.commit()

    return {"platform": platform_id, "profile": payload.model_dump(), "status": "saved"}


@router.post("/workspace/platform-profile/{platform_id}/push")
def push_platform_profile(
    platform_id: str,
    payload: PlatformProfile | None = None,
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    """Push editable fields to the platform API. Optionally accepts profile data to save first."""
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    bp = workspace.brand_profile

    # If payload provided, save it first
    if payload and bp:
        style = bp.style_notes or {}
        profiles = style.get("platform_profiles", {})
        profiles[platform_id] = payload.model_dump()
        style["platform_profiles"] = profiles
        bp.style_notes = style
        db.commit()

    saved = {}
    if bp and bp.style_notes:
        saved = bp.style_notes.get("platform_profiles", {}).get(platform_id, {})

    if not saved:
        raise HTTPException(status_code=400, detail="No profile data to push. Save the profile first.")

    caps = PLATFORM_CAPABILITIES.get(platform_id, {"can_edit": []})
    if not caps["can_edit"]:
        return {"status": "not_supported", "message": f"{platform_id} does not support profile editing via API"}

    try:
        if platform_id == "x" and saved.get("bio"):
            import requests
            from requests_oauthlib import OAuth1
            auth = OAuth1(settings.x_consumer_key, settings.x_consumer_secret,
                          settings.x_access_token, settings.x_access_token_secret)
            update_data = {}
            if saved.get("bio"):
                update_data["description"] = saved["bio"][:160]
            if saved.get("display_name"):
                update_data["name"] = saved["display_name"][:50]

            # Note: X API v2 doesn't have a profile update endpoint for user auth
            # Would need X API v1.1 which requires elevated access
            return {"status": "not_implemented", "message": "X profile update requires elevated API access. Edit manually at x.com/settings/profile"}

        elif platform_id == "facebook" and saved.get("bio"):
            page_id = settings.facebook_page_id
            page_token = settings.facebook_page_token
            if page_id and page_token:
                r = httpx.post(f"https://graph.facebook.com/v23.0/{page_id}",
                               params={"about": saved["bio"], "access_token": page_token}, timeout=10.0)
                if r.status_code == 200:
                    return {"status": "pushed", "message": "Facebook page About updated"}
                return {"status": "error", "message": f"Facebook update failed: {r.text[:100]}"}

        return {"status": "not_supported", "message": f"Push not implemented for {platform_id}"}

    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.get("/workspace/platform-profiles")
def list_platform_profiles(db: Session = Depends(get_db), _role: str = Depends(require_owner)):
    """Get all platform profiles — live data from APIs for connected platforms."""
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    bp = workspace.brand_profile

    saved = {}
    if bp and bp.style_notes:
        saved = bp.style_notes.get("platform_profiles", {})

    result = {}
    for pid, fetcher in PROFILE_FETCHERS.items():
        try:
            live = fetcher(settings)
            if live:
                result[pid] = {
                    "live": live,
                    "saved": saved.get(pid, {}),
                    "editable_fields": PLATFORM_CAPABILITIES.get(pid, {}).get("can_edit", []),
                }
        except Exception:
            pass

    return result
