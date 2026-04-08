"""
Account reset — wipe all data except API keys.
Clears database, corrections, training data, auth tokens.
"""
import logging
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text

from rebel_forge_backend.api.auth import require_owner
from rebel_forge_backend.db.session import get_db

logger = logging.getLogger("rebel_forge_backend.reset")

router = APIRouter()

DATA_DIR = Path(__file__).resolve().parents[4] / "data"
SRC_DATA_DIR = Path(__file__).resolve().parents[2] / "data"


@router.post("/account/reset")
def reset_account(db: Session = Depends(get_db), _role: str = Depends(require_owner)):
    """
    Full account reset. Deletes:
    - All drafts, jobs, events, published posts, assets, metrics
    - Brand profile and workspace
    - Corrections and training data files
    - Auth tokens (will regenerate on next request)

    Does NOT delete:
    - API keys in .env
    - Platform connections
    - Database schema (tables stay, data goes)
    """
    try:
        # Clear all tables in order (foreign keys matter)
        db.execute(text("DELETE FROM metric_snapshots"))
        db.execute(text("DELETE FROM events"))
        db.execute(text("DELETE FROM published_posts"))
        db.execute(text("DELETE FROM assets"))
        db.execute(text("DELETE FROM content_drafts"))
        db.execute(text("DELETE FROM jobs"))
        try:
            db.execute(text("DELETE FROM conversations"))
        except Exception:
            pass
        try:
            db.execute(text("DELETE FROM corrections"))
        except Exception:
            pass
        try:
            db.execute(text("DELETE FROM platform_styles"))
        except Exception:
            pass
        db.execute(text("DELETE FROM brand_profiles"))
        db.execute(text("DELETE FROM workspaces"))
        db.commit()
        logger.info("[reset] Database cleared")

        # Clear corrections files
        for corrections_dir in [DATA_DIR / "corrections", SRC_DATA_DIR / "corrections"]:
            if corrections_dir.exists():
                for f in corrections_dir.iterdir():
                    f.unlink()
                logger.info("[reset] Corrections cleared: %s", corrections_dir)

        # Clear training data
        for training_dir in [DATA_DIR / "training", SRC_DATA_DIR / "training"]:
            if training_dir.exists():
                for f in training_dir.iterdir():
                    f.unlink()
                logger.info("[reset] Training data cleared: %s", training_dir)

        # Clear auth tokens (will regenerate)
        for auth_file in [DATA_DIR / "auth_tokens.json", SRC_DATA_DIR / "auth_tokens.json"]:
            if auth_file.exists():
                auth_file.unlink()
                logger.info("[reset] Auth tokens cleared: %s", auth_file)

        # Clear settings cache so fresh workspace is created
        from rebel_forge_backend.core.config import get_settings
        get_settings.cache_clear()

        # Clear auth token cache
        from rebel_forge_backend.api.auth import _tokens
        import rebel_forge_backend.api.auth as auth_module
        auth_module._tokens = None

        return {
            "status": "reset_complete",
            "message": "All data cleared. API keys preserved. Log out and log back in with your new token.",
            "actions_needed": [
                "Log out from the frontend",
                "Get new token: curl localhost:8080/v1/auth/tokens",
                "Log in with new token",
            ],
        }

    except Exception as e:
        logger.error("[reset] Failed: %s", e)
        return {"status": "error", "error": str(e)}
