"""
LLM Provider management — switch between local vLLM and cloud providers dynamically.
"""

import logging
import shutil

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from rebel_forge_backend.api.auth import require_owner
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.db.session import get_db
from rebel_forge_backend.services.workspace import WorkspaceService

logger = logging.getLogger("rebel_forge_backend.providers")

router = APIRouter()

# Provider configurations
PROVIDER_CONFIGS = {
    "vllm": {
        "name": "vLLM (Local)",
        "base_url": "http://127.0.0.1:8000/v1",
        "api_style": "openai",
        "fields": ["base_url", "model", "api_key"],
        "default_model": "openai/gpt-oss-120b",
    },
    "openai": {
        "name": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "api_style": "openai",
        "fields": ["api_key", "model"],
        "default_model": "gpt-4.1",
    },
    "grok": {
        "name": "xAI Grok",
        "base_url": "https://api.x.ai/v1",
        "api_style": "openai",
        "fields": ["api_key", "model"],
        "default_model": "grok-3",
    },
    "openrouter": {
        "name": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "api_style": "openai",
        "fields": ["api_key", "model"],
        "default_model": "openai/gpt-4.1",
    },
    "codex": {
        "name": "Codex CLI (Local Agent)",
        "base_url": "",
        "api_style": "codex_cli",
        "fields": ["model"],
        "default_model": "codex",
    },
}


class ProviderConfig(BaseModel):
    provider: str
    base_url: str = ""
    api_key: str = ""
    model: str = ""


class ProviderStatus(BaseModel):
    active_provider: str
    active_model: str
    base_url: str
    providers: list[dict]


@router.get("/providers")
def list_providers(db: Session = Depends(get_db), _role: str = Depends(require_owner)):
    """List all available LLM providers and which is active."""
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    bp = workspace.brand_profile

    # Get the actual active provider (includes runtime fallback)
    from rebel_forge_backend.services.llm_config import get_active_llm

    llm = get_active_llm(db, settings)
    active_provider = llm.provider
    active_model = llm.model
    active_url = llm.base_url

    providers = []
    active_override = (bp.style_notes or {}).get("llm_provider", {}) if bp else {}
    for pid, config in PROVIDER_CONFIGS.items():
        # Check if credentials exist
        creds = {}
        if bp and bp.style_notes:
            creds = bp.style_notes.get("connections", {}).get(pid, {})

        has_key = bool(creds.get("api_key")) or (
            active_override.get("provider") == pid and bool(active_override.get("api_key"))
        )
        if pid == "vllm":
            has_key = bool(llm.base_url and llm.model)
        elif pid == "codex":
            has_key = shutil.which("codex") is not None

        providers.append(
            {
                "id": pid,
                "name": config["name"],
                "configured": has_key,
                "active": pid == active_provider,
                "default_model": config["default_model"],
                "fields": config["fields"],
            }
        )

    return {
        "active_provider": active_provider,
        "active_model": active_model,
        "base_url": active_url,
        "providers": providers,
    }


@router.put("/providers/active")
def set_active_provider(
    payload: ProviderConfig,
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    """Switch the active LLM provider."""
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    bp = workspace.brand_profile

    if not bp:
        raise HTTPException(status_code=400, detail="No brand profile")

    if payload.provider not in PROVIDER_CONFIGS:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {payload.provider}")

    if payload.provider == "codex" and shutil.which("codex") is None:
        raise HTTPException(
            status_code=409,
            detail="Codex CLI is not installed or is not available in PATH.",
        )

    config = PROVIDER_CONFIGS[payload.provider]

    from sqlalchemy.orm.attributes import flag_modified

    style = dict(bp.style_notes or {})
    connections = {
        key: dict(value) for key, value in style.get("connections", {}).items()
    }
    saved = connections.get(payload.provider, {})
    provider_config = {
        "provider": payload.provider,
        "base_url": payload.base_url or saved.get("base_url") or config["base_url"],
        "model": payload.model or saved.get("model") or config["default_model"],
        "api_key": payload.api_key or saved.get("api_key", ""),
    }
    connections[payload.provider] = provider_config
    style["connections"] = connections
    style["llm_provider"] = provider_config
    bp.style_notes = style
    flag_modified(bp, "style_notes")
    db.commit()

    logger.info(
        "[providers] Switched to %s (%s)",
        payload.provider,
        payload.model or config["default_model"],
    )

    return {
        "status": "switched",
        "provider": payload.provider,
        "model": payload.model or config["default_model"],
    }


@router.post("/providers/test")
def test_provider(
    payload: ProviderConfig,
    _role: str = Depends(require_owner),
):
    """Test if a provider is reachable with given credentials."""
    config = PROVIDER_CONFIGS.get(payload.provider)
    if not config:
        return {"status": "error", "error": f"Unknown provider: {payload.provider}"}

    base_url = payload.base_url or config["base_url"]
    api_key = payload.api_key

    try:
        if config["api_style"] == "codex_cli":
            import shutil
            import subprocess

            codex_bin = shutil.which("codex")
            if not codex_bin:
                return {"status": "error", "error": "codex binary not found in PATH"}
            r = subprocess.run([codex_bin, "--version"], capture_output=True, text=True, timeout=5)
            version = r.stdout.strip() or r.stderr.strip()
            return {"status": "ok", "models": [version or "codex"]}

        if config["api_style"] == "openai" or payload.provider == "vllm":
            # OpenAI-compatible (vLLM, OpenAI, Grok)
            headers = {}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"

            with httpx.Client(timeout=10.0) as client:
                r = client.get(f"{base_url}/models", headers=headers)
                if r.status_code == 200:
                    models = r.json().get("data", [])
                    model_names = [m.get("id", "") for m in models[:5]]
                    return {"status": "ok", "models": model_names}
                return {"status": "error", "error": f"HTTP {r.status_code}: {r.text[:100]}"}

    except Exception as e:
        return {"status": "error", "error": str(e)}

    return {"status": "error", "error": "Unsupported provider style"}
