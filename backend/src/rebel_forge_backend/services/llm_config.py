"""
Resolve active LLM provider — checks DB override first, falls back to .env settings.

Usage in any route/service:
    llm = get_active_llm(db, settings)
    # llm.base_url, llm.api_key, llm.model
"""
import logging
from dataclasses import dataclass

from sqlalchemy.orm import Session

from rebel_forge_backend.core.config import Settings
from rebel_forge_backend.services.workspace import WorkspaceService

logger = logging.getLogger("rebel_forge_backend.llm_config")


@dataclass
class LLMConfig:
    provider: str
    base_url: str
    api_key: str
    model: str


def get_active_llm(db: Session, settings: Settings) -> LLMConfig:
    """Resolve the active LLM provider. DB override wins over .env."""
    try:
        workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
        bp = workspace.brand_profile
        if bp and bp.style_notes:
            override = bp.style_notes.get("llm_provider")
            if override and override.get("provider"):
                return LLMConfig(
                    provider=override["provider"],
                    base_url=override.get("base_url", settings.llm_base_url),
                    api_key=override.get("api_key", settings.llm_api_key),
                    model=override.get("model", settings.llm_model),
                )
    except Exception as e:
        logger.warning("[llm_config] Failed to read DB override: %s", e)

    # Fallback: try vLLM first, if unreachable default to codex
    import httpx
    try:
        r = httpx.get(f"{settings.llm_base_url.rstrip('/v1')}/health", timeout=2.0)
        if r.status_code == 200:
            return LLMConfig(
                provider="vllm",
                base_url=settings.llm_base_url,
                api_key=settings.llm_api_key,
                model=settings.llm_model,
            )
    except Exception:
        pass

    # vLLM not reachable — default to Codex CLI
    logger.info("[llm_config] vLLM not reachable, defaulting to Codex CLI")
    return LLMConfig(
        provider="codex",
        base_url="",
        api_key="",
        model="codex",
    )
