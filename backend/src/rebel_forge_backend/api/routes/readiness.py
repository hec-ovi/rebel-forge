"""
System readiness — what's configured, what's not, what features are available.
Frontend uses this to enable/disable UI sections.
"""

import shutil

import httpx
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from rebel_forge_backend.api.auth import require_owner
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.db.session import get_db

router = APIRouter()


@router.get("/readiness")
def get_readiness(db: Session = Depends(get_db), _role: str = Depends(require_owner)):
    """Returns what's ready and what features are available."""
    settings = get_settings()

    # Check each system
    database = False
    try:
        from sqlalchemy import text

        db.execute(text("SELECT 1"))
        database = True
    except Exception:
        pass

    from rebel_forge_backend.services.llm_config import get_active_llm, health_url

    active_llm = get_active_llm(db, settings)

    def _http_provider_ready(base_url: str, api_key: str = "") -> bool:
        if not base_url:
            return False
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        try:
            response = httpx.get(
                f"{base_url.rstrip('/')}/models",
                headers=headers,
                timeout=3.0,
            )
            return response.status_code == 200
        except Exception:
            return False

    active_llm_ready = (
        shutil.which("codex") is not None
        if active_llm.provider == "codex"
        else _http_provider_ready(active_llm.base_url, active_llm.api_key)
    )

    vllm = _http_provider_ready(settings.llm_base_url, settings.llm_api_key)
    if not vllm:
        try:
            vllm = httpx.get(health_url(settings.llm_base_url), timeout=3.0).status_code == 200
        except Exception:
            pass

    media_api = _http_provider_ready(settings.media_base_url, settings.media_api_key)

    comfyui = False
    try:
        r = httpx.get(f"{settings.comfyui_base_url}/", timeout=3.0)
        comfyui = r.status_code == 200
    except Exception:
        pass

    fal_ai = bool(settings.fal_key)
    firecrawl = bool(
        settings.firecrawl_api_key and settings.firecrawl_api_key != "your-firecrawl-api-key"
    )
    r2 = bool(
        settings.r2_endpoint_url
        and settings.r2_public_url
        and settings.r2_endpoint_url != "your-r2-endpoint"
    )

    # Platform checks — just check if keys exist (not empty, not placeholder)
    def _has_key(val: str) -> bool:
        return bool(val) and not val.startswith("your-")

    platforms = {
        "x": _has_key(settings.x_consumer_key) and _has_key(settings.x_access_token),
        "linkedin": _has_key(settings.linkedin_access_token),
        "facebook": _has_key(settings.facebook_access_token),
        "instagram": _has_key(settings.instagram_access_token)
        and _has_key(settings.instagram_user_id),
        "threads": _has_key(settings.threads_access_token) and _has_key(settings.threads_user_id),
    }

    llm_labels = {
        "vllm": f"vLLM Local ({active_llm.model})",
        "codex": "Codex CLI (OpenAI)",
        "openrouter": f"OpenRouter ({active_llm.model})",
    }
    llm_label = llm_labels.get(active_llm.provider, f"LLM ({active_llm.model})")
    llm_ready = active_llm_ready

    # Feature availability based on what's ready
    features = {
        "rebel_chat": database and llm_ready,
        "draft_generation": database and llm_ready,
        "web_search": firecrawl,
        "image_generation": comfyui or fal_ai or media_api,
        "publish_x": database and platforms["x"],
        "publish_linkedin": database and platforms["linkedin"],
        "publish_facebook": database and platforms["facebook"],
        "publish_instagram": database and platforms["instagram"] and (comfyui or fal_ai or r2),
        "publish_threads": database and platforms["threads"],
        "heartbeat": database and llm_ready,
        "training": database and llm_ready,
        "analytics": database and any(platforms.values()),
        "share_links": database,
    }

    systems = {
        "database": {"ready": database, "label": "PostgreSQL", "group": "local"},
        "vllm": {
            "ready": vllm,
            "label": f"vLLM ({settings.llm_model})" if vllm else "vLLM",
            "group": "local",
        },
        "comfyui": {"ready": comfyui, "label": "ComfyUI (Images)", "group": "local"},
        "media_api": {
            "ready": media_api,
            "label": f"Image API ({settings.media_model})",
            "group": "active",
        },
        "llm": {
            "ready": llm_ready,
            "label": llm_label,
            "model": active_llm.model,
            "group": "active",
        },
        "firecrawl": {
            "ready": firecrawl,
            "label": "Firecrawl (Web Search)",
            "group": "cloud",
        },
        "fal_ai": {
            "ready": fal_ai,
            "label": f"fal.ai ({settings.fal_model})" if fal_ai else "fal.ai",
            "group": "cloud",
        },
        "cloudflare_r2": {
            "ready": r2,
            "label": "Cloudflare R2 (Storage)",
            "group": "cloud",
        },
    }

    return {
        "systems": systems,
        "platforms": {
            pid: {"ready": ready, "label": pid.capitalize()} for pid, ready in platforms.items()
        },
        "features": features,
        "setup_complete": database and llm_ready and any(platforms.values()),
        "summary": {
            "systems_ready": sum(1 for system in systems.values() if system["ready"]),
            "systems_total": len(systems),
            "platforms_ready": sum(1 for v in platforms.values() if v),
            "platforms_total": len(platforms),
            "features_available": sum(1 for v in features.values() if v),
            "features_total": len(features),
        },
    }
