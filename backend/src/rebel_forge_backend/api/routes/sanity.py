"""
Sanity checks — test each integration is working.
Tests credentials, connectivity, and basic operations.
"""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import httpx

from rebel_forge_backend.api.auth import require_owner
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.db.session import get_db

logger = logging.getLogger("rebel_forge_backend.sanity")

router = APIRouter()


def _check_vllm(settings) -> dict:
    try:
        r = httpx.get(f"{settings.llm_base_url.rstrip('/v1')}/health", timeout=5.0)
        if r.status_code == 200:
            r2 = httpx.get(f"{settings.llm_base_url}/models", timeout=5.0)
            model = r2.json()["data"][0]["id"] if r2.status_code == 200 else "unknown"
            return {"status": "ok", "model": model}
        return {"status": "error", "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def _check_comfyui(settings) -> dict:
    try:
        r = httpx.get(f"{settings.comfyui_base_url}/", timeout=5.0)
        return {"status": "ok"} if r.status_code == 200 else {"status": "error", "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def _check_fal_ai(settings) -> dict:
    if not settings.fal_key:
        return {"status": "not_configured"}
    try:
        r = httpx.get("https://fal.run/", headers={"Authorization": f"Key {settings.fal_key}"}, timeout=5.0)
        return {"status": "ok", "model": settings.fal_model}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def _check_firecrawl(settings) -> dict:
    if not settings.firecrawl_api_key:
        return {"status": "not_configured"}
    try:
        from rebel_forge_backend.providers.search.firecrawl import FirecrawlProvider
        fc = FirecrawlProvider(settings)
        results = fc.search("test", limit=1)
        return {"status": "ok", "results": len(results)}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def _check_r2(settings) -> dict:
    if not settings.r2_endpoint_url:
        return {"status": "not_configured"}
    try:
        from rebel_forge_backend.services.cloud_storage import CloudStorage
        cloud = CloudStorage(settings)
        url = cloud.upload_bytes(b"sanity_check", "sanity_test.txt", "text/plain")
        cloud.delete("sanity_test.txt")
        return {"status": "ok", "url": url}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def _check_x(settings) -> dict:
    if not settings.x_consumer_key:
        return {"status": "not_configured"}
    try:
        from rebel_forge_backend.providers.publishers.x_twitter import XPublisher
        pub = XPublisher(settings.x_consumer_key, settings.x_consumer_secret,
                         settings.x_access_token, settings.x_access_token_secret)
        # Verify credentials by trying to read (not post)
        import requests
        from requests_oauthlib import OAuth1
        auth = OAuth1(settings.x_consumer_key, settings.x_consumer_secret,
                      settings.x_access_token, settings.x_access_token_secret)
        r = requests.get("https://api.twitter.com/2/users/me", auth=auth, timeout=10)
        if r.status_code == 200:
            user = r.json().get("data", {})
            return {"status": "ok", "username": user.get("username", "?"), "name": user.get("name", "?")}
        return {"status": "error", "error": f"HTTP {r.status_code}: {r.text[:100]}"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def _check_linkedin(settings) -> dict:
    if not settings.linkedin_access_token:
        return {"status": "not_configured"}
    try:
        r = httpx.get("https://api.linkedin.com/v2/userinfo",
                       headers={"Authorization": f"Bearer {settings.linkedin_access_token}"}, timeout=10.0)
        if r.status_code == 200:
            data = r.json()
            return {"status": "ok", "name": data.get("name", "?")}
        return {"status": "error", "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def _check_facebook(settings) -> dict:
    if not settings.facebook_access_token:
        return {"status": "not_configured"}
    try:
        r = httpx.get("https://graph.facebook.com/v23.0/me/accounts",
                       params={"access_token": settings.facebook_access_token}, timeout=10.0)
        if r.status_code == 200:
            pages = r.json().get("data", [])
            return {"status": "ok", "pages": [p.get("name") for p in pages]}
        return {"status": "error", "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def _check_instagram(settings) -> dict:
    if not settings.instagram_access_token:
        return {"status": "not_configured"}
    try:
        r = httpx.get(f"https://graph.instagram.com/v23.0/{settings.instagram_user_id}",
                       params={"fields": "id,username", "access_token": settings.instagram_access_token}, timeout=10.0)
        if r.status_code == 200:
            return {"status": "ok", "username": r.json().get("username", "?")}
        return {"status": "error", "error": f"HTTP {r.status_code}: {r.text[:100]}"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def _check_threads(settings) -> dict:
    if not settings.threads_access_token:
        return {"status": "not_configured"}
    try:
        r = httpx.get(f"https://graph.threads.net/v1.0/me",
                       params={"fields": "id,username", "access_token": settings.threads_access_token}, timeout=10.0)
        if r.status_code == 200:
            return {"status": "ok", "username": r.json().get("username", "?")}
        return {"status": "error", "error": f"HTTP {r.status_code}: {r.text[:100]}"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def _check_db(db: Session) -> dict:
    try:
        from sqlalchemy import text
        db.execute(text("SELECT 1"))
        count = db.execute(text("SELECT count(*) FROM events")).scalar()
        return {"status": "ok", "events_count": count}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@router.get("/sanity")
def run_sanity_checks(db: Session = Depends(get_db), _role: str = Depends(require_owner)):
    """Run all sanity checks — tests every integration."""
    settings = get_settings()

    results = {
        "database": _check_db(db),
        "vllm": _check_vllm(settings),
        "comfyui": _check_comfyui(settings),
        "fal_ai": _check_fal_ai(settings),
        "firecrawl": _check_firecrawl(settings),
        "cloudflare_r2": _check_r2(settings),
        "x": _check_x(settings),
        "linkedin": _check_linkedin(settings),
        "facebook": _check_facebook(settings),
        "instagram": _check_instagram(settings),
        "threads": _check_threads(settings),
    }

    all_ok = all(r["status"] in ("ok", "not_configured") for r in results.values())
    configured = sum(1 for r in results.values() if r["status"] == "ok")
    not_configured = sum(1 for r in results.values() if r["status"] == "not_configured")
    errors = sum(1 for r in results.values() if r["status"] == "error")

    return {
        "healthy": all_ok,
        "summary": f"{configured} ok, {not_configured} not configured, {errors} errors",
        "checks": results,
    }


@router.get("/sanity/{service}")
def run_single_sanity_check(service: str, db: Session = Depends(get_db), _role: str = Depends(require_owner)):
    """Run a single sanity check."""
    settings = get_settings()

    checkers = {
        "database": lambda: _check_db(db),
        "vllm": lambda: _check_vllm(settings),
        "comfyui": lambda: _check_comfyui(settings),
        "firecrawl": lambda: _check_firecrawl(settings),
        "cloudflare_r2": lambda: _check_r2(settings),
        "r2": lambda: _check_r2(settings),
        "x": lambda: _check_x(settings),
        "linkedin": lambda: _check_linkedin(settings),
        "facebook": lambda: _check_facebook(settings),
        "instagram": lambda: _check_instagram(settings),
        "threads": lambda: _check_threads(settings),
    }

    checker = checkers.get(service)
    if not checker:
        return {"status": "error", "error": f"Unknown service: {service}. Available: {', '.join(checkers.keys())}"}

    return {"service": service, **checker()}
