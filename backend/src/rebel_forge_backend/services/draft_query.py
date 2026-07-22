from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from rebel_forge_backend.db.models import ContentDraft, DraftStatus, PublishedPost

ALLOWED_RESOURCES = {"drafts", "published_posts"}
ALLOWED_OPERATIONS = {"list", "count"}


def get_workspace_draft(
    db: Session,
    *,
    workspace_id: UUID,
    draft_id: object,
) -> ContentDraft | None:
    """Resolve a draft ID while enforcing workspace ownership."""
    try:
        resolved_id = UUID(str(draft_id))
    except (TypeError, ValueError):
        return None
    return db.scalar(
        select(ContentDraft).where(
            ContentDraft.id == resolved_id,
            ContentDraft.workspace_id == workspace_id,
        )
    )


def query_workspace_content(
    db: Session,
    *,
    workspace_id: UUID,
    resource: str = "drafts",
    operation: str = "list",
    platform: str | None = None,
    status: str | None = None,
    search: str | None = None,
    limit: int = 20,
) -> dict[str, Any]:
    """Query allowlisted content fields while always enforcing workspace isolation."""
    if resource not in ALLOWED_RESOURCES:
        raise ValueError(f"Unsupported resource: {resource}")
    if operation not in ALLOWED_OPERATIONS:
        raise ValueError(f"Unsupported operation: {operation}")
    if resource == "published_posts" and status:
        raise ValueError("Status filtering is only supported for drafts")
    if status and status not in {item.value for item in DraftStatus}:
        raise ValueError(f"Unsupported draft status: {status}")

    bounded_limit = min(max(int(limit), 1), 50)
    model = ContentDraft if resource == "drafts" else PublishedPost
    filters = [model.workspace_id == workspace_id]
    if platform:
        filters.append(model.platform == platform.lower())
    if status:
        filters.append(ContentDraft.status == DraftStatus(status))
    if search:
        term = f"%{search.strip()}%"
        if resource == "drafts":
            filters.append(
                or_(
                    ContentDraft.concept.ilike(term),
                    ContentDraft.caption.ilike(term),
                )
            )
        else:
            filters.append(PublishedPost.platform_post_id.ilike(term))

    if operation == "count":
        count = db.scalar(select(func.count()).select_from(model).where(*filters)) or 0
        return {"count": count}

    rows = db.scalars(
        select(model).where(*filters).order_by(model.created_at.desc()).limit(bounded_limit)
    ).all()
    if resource == "drafts":
        return {
            "results": [
                {
                    "id": str(row.id),
                    "platform": row.platform,
                    "status": row.status.value,
                    "concept": row.concept,
                    "caption": row.caption,
                    "created_at": row.created_at.isoformat(),
                }
                for row in rows
            ]
        }
    return {
        "results": [
            {
                "id": str(row.id),
                "draft_id": str(row.draft_id) if row.draft_id else None,
                "platform": row.platform,
                "platform_post_id": row.platform_post_id,
                "published_at": row.published_at.isoformat() if row.published_at else None,
                "created_at": row.created_at.isoformat(),
            }
            for row in rows
        ]
    }
