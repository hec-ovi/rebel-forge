"""
Resolve active LLM provider — checks DB override first, falls back to .env settings.

Usage in any route/service:
    llm = get_active_llm(db, settings)
    # llm.base_url, llm.api_key, llm.model
"""

import logging
import shutil
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy.orm import Session

from rebel_forge_backend.core.config import Settings
from rebel_forge_backend.services.workspace import WorkspaceService

logger = logging.getLogger("rebel_forge_backend.llm_config")

SUPPORTED_PROVIDERS = {"vllm", "openai", "grok", "openrouter", "codex"}


@dataclass
class LLMConfig:
    provider: str
    base_url: str
    api_key: str
    model: str


def health_url(base_url: str) -> str:
    """Derive the provider health endpoint without corrupting URL suffixes."""
    parts = urlsplit(base_url)
    path = parts.path.rstrip("/")
    if path == "/v1" or path.endswith("/v1"):
        path = path[:-3]
    path = f"{path}/health" or "/health"
    return urlunsplit((parts.scheme, parts.netloc, path, "", ""))


def get_active_llm(db: Session, settings: Settings) -> LLMConfig:
    """Resolve the active LLM provider. DB override wins over .env."""
    try:
        workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
        bp = workspace.brand_profile
        if bp and bp.style_notes:
            override = bp.style_notes.get("llm_provider")
            if override and override.get("provider"):
                provider = override["provider"]
                if provider not in SUPPORTED_PROVIDERS:
                    logger.warning("[llm_config] Ignoring unsupported DB provider: %s", provider)
                    raise ValueError(f"Unsupported LLM provider: {provider}")
                if provider == "codex" and not shutil.which("codex"):
                    logger.warning("[llm_config] Ignoring unavailable Codex DB provider")
                    raise ValueError("Codex CLI is not installed")
                return LLMConfig(
                    provider=provider,
                    base_url=override.get("base_url", settings.llm_base_url),
                    api_key=override.get("api_key", settings.llm_api_key),
                    model=override.get("model", settings.llm_model),
                )
    except Exception as e:
        logger.warning("[llm_config] Failed to read DB override: %s", e)

    # Fallback: try vLLM first, if unreachable default to codex
    import httpx

    try:
        r = httpx.get(health_url(settings.llm_base_url), timeout=2.0)
        if r.status_code == 200:
            return LLMConfig(
                provider="vllm",
                base_url=settings.llm_base_url,
                api_key=settings.llm_api_key,
                model=settings.llm_model,
            )
    except Exception:
        pass

    if shutil.which("codex"):
        logger.info("[llm_config] vLLM not reachable, defaulting to Codex CLI")
        return LLMConfig(provider="codex", base_url="", api_key="", model="codex")

    logger.warning("[llm_config] Neither vLLM nor Codex CLI is reachable")
    return LLMConfig(
        provider="vllm",
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key,
        model=settings.llm_model,
    )
