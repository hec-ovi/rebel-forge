"""
Correction service — learns from user edits.

Corrections are stored through the mapped `Correction` model so UUID binding
follows the dialect in use, instead of raw SQL that assumes one UUID text form.
"""

import logging
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from rebel_forge_backend.db.models import Correction

logger = logging.getLogger("rebel_forge_backend.corrections")


def store_correction(
    *,
    db: Session,
    workspace_id: UUID,
    draft_id: UUID | None,
    original_text: str,
    corrected_text: str,
    context: dict | None = None,
) -> None:
    """Store a correction in the database."""
    platform = (context or {}).get("platform", "")
    rating = (context or {}).get("rating", 3)
    feedback = (context or {}).get("feedback", "")
    source = (context or {}).get("source", "training")

    db.add(
        Correction(
            workspace_id=workspace_id,
            draft_id=draft_id,
            original_text=original_text,
            corrected_text=corrected_text,
            context=context or None,
            platform=platform,
            rating=rating,
            feedback=feedback,
            had_edits=original_text != corrected_text,
            source=source,
        )
    )
    db.flush()
    logger.info(
        "[corrections] Stored correction for workspace %s platform=%s", workspace_id, platform
    )


def _recent_corrections(
    db: Session,
    workspace_id: UUID,
    limit: int,
    platform: str | None,
) -> list[Correction]:
    query = select(Correction).where(Correction.workspace_id == workspace_id)
    if platform:
        query = query.where(Correction.platform == platform)
    query = query.order_by(Correction.created_at.desc()).limit(limit)
    return list(db.scalars(query).all())


def list_corrections(
    db: Session, workspace_id: UUID, limit: int = 50, platform: str | None = None
) -> list[dict]:
    """List corrections as structured data, optionally filtered by platform."""
    return [
        {
            "original": row.original_text,
            "corrected": row.corrected_text,
            "platform": row.platform,
            "rating": row.rating,
            "feedback": row.feedback,
            "had_edits": row.had_edits,
            "source": row.source,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in _recent_corrections(db, workspace_id, limit, platform)
    ]


def get_corrections_context(db: Session, workspace_id: UUID, platform: str | None = None) -> str:
    """Build markdown context string for prompt injection, optionally filtered by platform."""
    rows = _recent_corrections(db, workspace_id, 50, platform)
    if not rows:
        return ""

    entries = []
    for row in rows:
        feedback_line = f"\n**Feedback:** {row.feedback}" if row.feedback else ""
        entries.append(f"""## Correction ({row.platform or "general"})
**Original:** {row.original_text}
**Changed to:** {row.corrected_text}{feedback_line}
**Rating:** {row.rating or 3}/5""")

    content = "\n\n".join(entries)

    return f"""
The user has previously corrected AI-generated content. Learn from these patterns and apply the same style:

{content}

Apply these preferences to all new content.
"""


def get_corrections_count(db: Session, workspace_id: UUID) -> int:
    """Count total corrections for a workspace."""
    count = db.scalar(
        select(func.count())
        .select_from(Correction)
        .where(Correction.workspace_id == workspace_id)
    )
    return count or 0
