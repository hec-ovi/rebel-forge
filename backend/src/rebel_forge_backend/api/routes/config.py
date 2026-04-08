from fastapi import APIRouter, Depends

from rebel_forge_backend.api.auth import require_owner
from rebel_forge_backend.core.config import get_settings

router = APIRouter()


@router.get("/config")
def read_config(_role: str = Depends(require_owner)) -> dict[str, str]:
    settings = get_settings()
    return {
        "app_env": settings.app_env,
        "llm_provider": settings.llm_provider,
        "llm_base_url": settings.llm_base_url,
        "llm_model": settings.llm_model,
        "media_provider": settings.media_provider,
        "media_base_url": settings.media_base_url,
        "media_model": settings.media_model,
        "storage_backend": settings.storage_backend,
    }
