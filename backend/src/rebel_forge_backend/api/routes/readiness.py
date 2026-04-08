"""
System readiness — what's configured, what's not, what features are available.
Frontend uses this to enable/disable UI sections.
"""
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

    llm = False
    llm_model = ""
    try:
        r = httpx.get(f"{settings.llm_base_url.rstrip('/v1')}/health", timeout=3.0)
        if r.status_code == 200:
            llm = True
            r2 = httpx.get(f"{settings.llm_base_url}/models", timeout=3.0)
            if r2.status_code == 200:
                models = r2.json().get("data", [])
                llm_model = models[0]["id"] if models else ""
    except Exception:
        pass

    comfyui = False
    try:
        r = httpx.get(f"{settings.comfyui_base_url}/", timeout=3.0)
        comfyui = r.status_code == 200
    except Exception:
        pass

    fal_ai = bool(settings.fal_key)
    firecrawl = bool(settings.firecrawl_api_key and settings.firecrawl_api_key != "your-firecrawl-api-key")
    r2 = bool(settings.r2_endpoint_url and settings.r2_public_url and settings.r2_endpoint_url != "your-r2-endpoint")

    # Platform checks — just check if keys exist (not empty, not placeholder)
    def _has_key(val: str) -> bool:
        return bool(val) and not val.startswith("your-")

    platforms = {
        "x": _has_key(settings.x_consumer_key) and _has_key(settings.x_access_token),
        "linkedin": _has_key(settings.linkedin_access_token),
        "facebook": _has_key(settings.facebook_access_token),
        "instagram": _has_key(settings.instagram_access_token) and _has_key(settings.instagram_user_id),
        "threads": _has_key(settings.threads_access_token) and _has_key(settings.threads_user_id),
    }

    # Resolve active LLM provider for accurate label
    from rebel_forge_backend.services.llm_config import get_active_llm
    active_llm = get_active_llm(db, settings)
    llm_labels = {
        "vllm": f"vLLM Local ({active_llm.model})",
        "codex": "Codex CLI (OpenAI)",
        "openrouter": f"OpenRouter ({active_llm.model})",
    }
    llm_label = llm_labels.get(active_llm.provider, f"LLM ({active_llm.model})")
    llm_ready = llm or active_llm.provider == "codex"  # codex doesn't need health check

    # Feature availability based on what's ready
    features = {
        "rebel_chat": database and llm_ready,
        "draft_generation": database and llm_ready,
        "web_search": firecrawl,
        "image_generation": comfyui or fal_ai,
        "publish_x": database and platforms["x"],
        "publish_linkedin": database and platforms["linkedin"],
        "publish_facebook": database and platforms["facebook"],
        "publish_instagram": database and platforms["instagram"] and (comfyui or fal_ai or r2),
        "publish_threads": database and platforms["threads"],
        "heartbeat": database and llm_ready,
        "training": database and llm_ready,
        "analytics": database and any(platforms.values()),
        "inbox": any(platforms.values()),
        "share_links": database,
    }

    return {
        "systems": {
            "database": {"ready": database, "label": "PostgreSQL", "group": "local"},
            "vllm": {"ready": llm, "label": f"vLLM ({settings.llm_model})" if llm else "vLLM", "group": "local"},
            "comfyui": {"ready": comfyui, "label": "ComfyUI (Images)", "group": "local"},
            "llm": {"ready": llm_ready, "label": llm_label, "model": active_llm.model, "group": "active"},
            "firecrawl": {"ready": firecrawl, "label": "Firecrawl (Web Search)", "group": "cloud"},
            "fal_ai": {"ready": fal_ai, "label": f"fal.ai ({settings.fal_model})" if fal_ai else "fal.ai", "group": "cloud"},
            "cloudflare_r2": {"ready": r2, "label": "Cloudflare R2 (Storage)", "group": "cloud"},
        },
        "platforms": {
            pid: {"ready": ready, "label": pid.capitalize()}
            for pid, ready in platforms.items()
        },
        "features": features,
        "setup_complete": database and llm_ready and any(platforms.values()),
        "summary": {
            "systems_ready": sum(1 for s in [database, llm, comfyui, firecrawl, r2] if s),
            "systems_total": 5,
            "platforms_ready": sum(1 for v in platforms.values() if v),
            "platforms_total": len(platforms),
            "features_available": sum(1 for v in features.values() if v),
            "features_total": len(features),
        },
    }
