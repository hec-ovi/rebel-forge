"""
Correction service — learns from user edits.

Stores corrections in PostgreSQL for proper querying, filtering by platform,
and future pgvector semantic search.
"""
import json
import logging
from uuid import UUID

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

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
    had_edits = original_text != corrected_text

    db.execute(sql_text(
        """INSERT INTO corrections (workspace_id, draft_id, original_text, corrected_text, context, platform, rating, feedback, had_edits, source)
           VALUES (:wid, :did, :orig, :corr, :ctx, :platform, :rating, :feedback, :had_edits, :source)"""
    ), {
        "wid": str(workspace_id),
        "did": str(draft_id) if draft_id else None,
        "orig": original_text[:500],
        "corr": corrected_text[:500],
        "ctx": json.dumps(context) if context else None,
        "platform": platform,
        "rating": rating,
        "feedback": feedback,
        "had_edits": had_edits,
        "source": source,
    })
    db.commit()
    logger.info("[corrections] Stored correction for workspace %s platform=%s", workspace_id, platform)


def list_corrections(db: Session, workspace_id: UUID, limit: int = 50, platform: str | None = None) -> list[dict]:
    """List corrections as structured data, optionally filtered by platform."""
    query = "SELECT original_text, corrected_text, platform, rating, feedback, had_edits, source, created_at FROM corrections WHERE workspace_id = :wid"
    params: dict = {"wid": str(workspace_id)}

    if platform:
        query += " AND platform = :platform"
        params["platform"] = platform

    query += " ORDER BY created_at DESC LIMIT :limit"
    params["limit"] = limit

    rows = db.execute(sql_text(query), params).fetchall()

    return [
        {
            "original": r[0],
            "corrected": r[1],
            "platform": r[2],
            "rating": r[3],
            "feedback": r[4],
            "had_edits": r[5],
            "source": r[6],
            "created_at": r[7].isoformat() if r[7] else None,
        }
        for r in rows
    ]


def get_corrections_context(db: Session, workspace_id: UUID, platform: str | None = None) -> str:
    """Build markdown context string for prompt injection, optionally filtered by platform."""
    query = "SELECT platform, original_text, corrected_text, feedback, rating FROM corrections WHERE workspace_id = :wid"
    params: dict = {"wid": str(workspace_id)}

    if platform:
        query += " AND platform = :platform"
        params["platform"] = platform

    query += " ORDER BY created_at DESC LIMIT 50"

    rows = db.execute(sql_text(query), params).fetchall()

    if not rows:
        return ""

    entries = []
    for r in rows:
        plat, orig, corr, fb, rating = r
        feedback_line = f"\n**Feedback:** {fb}" if fb else ""
        entries.append(f"""## Correction ({plat or 'general'})
**Original:** {orig[:200]}
**Changed to:** {corr[:200]}{feedback_line}
**Rating:** {rating or 3}/5""")

    content = "\n\n".join(entries)

    return f"""
The user has previously corrected AI-generated content. Learn from these patterns and apply the same style:

{content}

Apply these preferences to all new content.
"""


def get_corrections_count(db: Session, workspace_id: UUID) -> int:
    """Count total corrections for a workspace."""
    result = db.execute(sql_text(
        "SELECT COUNT(*) FROM corrections WHERE workspace_id = :wid"
    ), {"wid": str(workspace_id)}).scalar()
    return result or 0
