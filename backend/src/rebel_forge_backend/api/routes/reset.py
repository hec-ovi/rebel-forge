"""
Account reset clears application data and auth tokens.
Credentials in the backend environment file are preserved. Provider overrides stored in
the brand profile are removed with the rest of the workspace data.
"""

import logging
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from rebel_forge_backend.api.auth import clear_token_cache, get_token_file, require_owner
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.core.paths import BACKEND_ROOT, data_path, resolve_runtime_path
from rebel_forge_backend.db.session import get_db

logger = logging.getLogger("rebel_forge_backend.reset")

router = APIRouter()


def _remove_reset_directory(path: Path) -> None:
    """Remove a configured data directory while refusing broad protected paths."""
    resolved = path.resolve()
    protected = {
        Path(resolved.anchor),
        Path.home().resolve(),
        BACKEND_ROOT.resolve(),
        BACKEND_ROOT.parent.resolve(),
    }
    if any(item == resolved or item.is_relative_to(resolved) for item in protected):
        raise RuntimeError(f"Refusing to remove broad reset path: {resolved}")
    if resolved.exists():
        shutil.rmtree(resolved)
        logger.info("[reset] Cleared %s", resolved)


@router.post("/account/reset")
def reset_account(db: Session = Depends(get_db), _role: str = Depends(require_owner)):
    """
    Full account reset. Deletes:
    - All drafts, jobs, events, published posts, assets, metrics
    - Brand profile and workspace
    - Corrections and training data files
    - Auth tokens (will regenerate on next request)

    Does not delete credentials in backend/.env or the database schema. Provider
    configuration stored inside the deleted brand profile must be reconfigured.
    """
    try:
        # Clear child tables before their parents so the transaction remains valid.
        tables = (
            "metric_snapshots",
            "published_posts",
            "publish_jobs",
            "assets",
            "corrections",
            "content_drafts",
            "conversations",
            "platform_styles",
            "events",
            "publish_accounts",
            "jobs",
            "brand_profiles",
            "workspaces",
        )
        for table in tables:
            db.execute(text(f"DELETE FROM {table}"))
        db.commit()
        logger.info("[reset] Database cleared")

        settings = get_settings()
        reset_directories = {
            data_path(settings, "corrections"),
            data_path(settings, "style_learning"),
            data_path(settings, "training"),
            resolve_runtime_path(settings.storage_base_path),
        }
        for directory in reset_directories:
            _remove_reset_directory(directory)

        token_file = get_token_file(settings)
        token_file.unlink(missing_ok=True)
        clear_token_cache()
        get_settings.cache_clear()

        return {
            "status": "reset_complete",
            "message": (
                "Application data cleared. Environment credentials were preserved; "
                "database-stored provider selection was removed."
            ),
            "actions_needed": [
                "Log out from the frontend",
                "Run rebel-forge-tokens on the API host to generate new login tokens",
                "Reconfigure the active LLM provider if it was stored in the workspace",
                "Log in with new token",
            ],
        }

    except Exception as exc:
        db.rollback()
        logger.exception("[reset] Failed")
        raise HTTPException(status_code=500, detail="Account reset failed") from exc
