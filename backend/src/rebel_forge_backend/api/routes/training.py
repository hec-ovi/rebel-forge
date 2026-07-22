"""
Training — learn from user preferences through practice and feedback.
- Generate sample content for user to rate/correct
- Analyze past corrections and produce recommendations
- Store recommendations as persistent .md files the agent uses
"""

import json
import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from rebel_forge_backend.api.auth import require_owner
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.core.paths import data_path, prompts_path
from rebel_forge_backend.db.models import ContentDraft
from rebel_forge_backend.db.session import get_db
from rebel_forge_backend.services.corrections import get_corrections_context, store_correction
from rebel_forge_backend.services.workspace import WorkspaceService

logger = logging.getLogger("rebel_forge_backend.training")

router = APIRouter()


def _load_prompt(name: str) -> str:
    path = prompts_path(get_settings(), f"{name}.md")
    return path.read_text().strip() if path.exists() else ""


class TrainingSample(BaseModel):
    """A sample the agent generated for the user to rate."""

    platform: Literal["x", "linkedin", "facebook", "instagram", "threads"] = "x"
    topic: str = ""
    product_id: str | None = None  # Link to a product/topic


class TrainingFeedback(BaseModel):
    """User feedback on a training sample."""

    original: str = Field(min_length=1)
    corrected: str
    feedback: str = ""  # User comment: "too buzzy", "avoid emojis", "more hype"
    platform: Literal["x", "linkedin", "facebook", "instagram", "threads"] = "x"
    topic: str = ""
    product_id: str | None = None
    rating: int = Field(default=3, ge=1, le=5)


class RecommendationResponse(BaseModel):
    recommendations: dict
    corrections_count: int
    drafts_analyzed: int


@router.post("/training/sample")
def generate_training_sample(
    payload: TrainingSample,
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    """Generate a sample post for the user to rate and correct."""
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    bp = workspace.brand_profile

    from rebel_forge_backend.services.context_builder import build_context, get_mode_description

    unified_context = build_context(
        db=db,
        settings=settings,
        mode="training",
        mode_description=get_mode_description("training"),
        platform=payload.platform,
    )

    # Get specific product context if selected
    product_context = ""
    if payload.product_id and bp and bp.style_notes:
        products = bp.style_notes.get("products", [])
        for p in products:
            if p.get("id") == payload.product_id:
                product_context = f"\nGenerate for this specific product: {p.get('name', '')} — {p.get('description', '')}"
                break

    prompt = f"""{unified_context}

Generate exactly 1 sample {payload.platform} post for training purposes.
Topic: {payload.topic or "anything relevant to the brand"}
{product_context}

Return ONLY the post text, nothing else. No JSON, no explanation. Just the caption with hashtags."""

    try:
        from rebel_forge_backend.services.text_generation import generate_text

        text = generate_text(
            db,
            settings,
            instructions="You generate social media posts. Return only the post text.",
            prompt=prompt,
        )

        return {
            "sample": text.strip(),
            "platform": payload.platform,
            "topic": payload.topic,
            "product_id": payload.product_id,
        }

    except Exception as e:
        logger.error("[training] Sample generation failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Training provider failed: {e}") from e


@router.get("/training/corrections")
def list_training_corrections(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    """List all training corrections with their scores."""
    from rebel_forge_backend.services.corrections import list_corrections

    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    corrections = list_corrections(db, workspace.id, limit=limit)

    return {"corrections": corrections, "total": len(corrections)}


@router.post("/training/feedback")
def submit_training_feedback(
    payload: TrainingFeedback,
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    """User submits feedback on a training sample — stores as correction."""
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)

    store_correction(
        db=db,
        workspace_id=workspace.id,
        draft_id=None,
        original_text=payload.original,
        corrected_text=payload.corrected,
        context={
            "platform": payload.platform,
            "topic": payload.topic,
            "product_id": payload.product_id,
            "rating": payload.rating,
            "feedback": payload.feedback,
            "source": "training",
        },
    )
    db.commit()
    logger.info("[training] Correction stored (rating=%d)", payload.rating)

    return {"status": "saved", "had_edits": payload.original != payload.corrected}


@router.get("/training/recommendations", response_model=RecommendationResponse)
def get_recommendations(
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    """Analyze past corrections and drafts to generate recommendations."""
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    bp = workspace.brand_profile

    # Get corrections context
    corrections = get_corrections_context(db, workspace.id)
    corrections_count = corrections.count("## Correction") if corrections else 0

    # Get recent drafts for analysis
    recent_drafts = db.scalars(
        select(ContentDraft)
        .where(ContentDraft.workspace_id == workspace.id)
        .order_by(ContentDraft.created_at.desc())
        .limit(20)
    ).all()

    drafts_summary = [
        {
            "concept": d.concept,
            "platform": d.platform,
            "status": d.status if isinstance(d.status, str) else d.status.value,
        }
        for d in recent_drafts
    ]

    training_prompt = _load_prompt("training")
    context = f"""Brand voice: {bp.voice_summary or "not set"}
Audience: {bp.audience_summary or "not set"}
Goals: {bp.goals}

Past corrections ({corrections_count} total):
{corrections or "No corrections yet — the agent has no training data."}

Recent drafts ({len(drafts_summary)} total):
{json.dumps(drafts_summary[:10], indent=2)}
"""

    try:
        from rebel_forge_backend.services.text_generation import generate_text

        text = generate_text(db, settings, instructions=training_prompt, prompt=context)

        # Parse JSON — try extraction, fall back to structured summary
        recommendations = {}
        try:
            start = text.find("{")
            end = text.rfind("}") + 1
            if start >= 0 and end > start:
                parsed = json.loads(text[start:end])
                recommendations = parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            pass

        if not recommendations or "raw" in recommendations:
            # LLM didn't return JSON — extract insights from text
            recommendations = {
                "tone_patterns": ["Direct, no-fluff writing style"]
                if "direct" in text.lower()
                else [],
                "avoid": [
                    line.strip("- ").strip()
                    for line in text.split("\n")
                    if "avoid" in line.lower()
                    or "jargon" in line.lower()
                    or "remove" in line.lower()
                ],
                "prefer": [
                    line.strip("- ").strip()
                    for line in text.split("\n")
                    if "prefer" in line.lower() or "use" in line.lower() or "keep" in line.lower()
                ],
                "analysis": text,
                "confidence": "medium" if corrections_count >= 5 else "low",
            }

        # Save recommendations to file for future use
        training_dir = data_path(settings, "training")
        training_dir.mkdir(parents=True, exist_ok=True)
        recs_path = training_dir / f"{workspace.id}_recommendations.json"
        recs_path.write_text(json.dumps(recommendations, indent=2))
        logger.info("[training] Recommendations saved to %s", recs_path)

        return RecommendationResponse(
            recommendations=recommendations,
            corrections_count=corrections_count,
            drafts_analyzed=len(drafts_summary),
        )

    except Exception as e:
        logger.error("[training] Recommendations failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Training provider failed: {e}") from e


@router.get("/training/status")
def training_status(db: Session = Depends(get_db), _role: str = Depends(require_owner)):
    """Report saved corrections, recommendations, drafts, and imported style context."""
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)

    from rebel_forge_backend.services.corrections import get_corrections_count

    corrections_count = get_corrections_count(db, workspace.id)

    total_drafts = db.execute(
        select(ContentDraft).where(ContentDraft.workspace_id == workspace.id)
    ).all()

    # Check if recommendations exist
    training_dir = data_path(settings, "training")
    training_dir.mkdir(parents=True, exist_ok=True)
    recs_path = training_dir / f"{workspace.id}_recommendations.json"
    has_recommendations = recs_path.exists()

    # Check imported style-context files.
    style_dir = data_path(settings, "style_learning")
    style_platforms = []
    if style_dir.exists():
        style_platforms = [f.stem for f in style_dir.glob("*.md") if f.stat().st_size > 0]

    return {
        "corrections_count": corrections_count,
        "total_drafts": len(total_drafts),
        "has_recommendations": has_recommendations,
        "training_level": "none"
        if corrections_count == 0
        else "basic"
        if corrections_count < 5
        else "moderate"
        if corrections_count < 20
        else "strong",
        "style_context_platforms": style_platforms,
    }


class StylePost(BaseModel):
    text: str = Field(min_length=1)
    metrics: dict[str, float] = Field(default_factory=dict)
    created_at: str | None = None


class StyleImportRequest(BaseModel):
    platform: Literal["x", "linkedin", "facebook", "instagram", "threads"]
    posts: list[StylePost] = Field(min_length=1, max_length=200)


@router.post("/training/style-learn")
def import_style_examples(
    payload: StyleImportRequest,
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    """Import raw platform posts as prompt context, ordered by engagement."""
    settings = get_settings()
    WorkspaceService(settings).get_or_create_primary_workspace(db)

    style_dir = data_path(settings, "style_learning")
    style_dir.mkdir(parents=True, exist_ok=True)

    lines = [f"# Imported Style Examples - {payload.platform.upper()}\n"]
    lines.append(f"Imported {len(payload.posts)} raw posts from {payload.platform}.\n")
    lines.append("Use these posts as writing examples. No model training or synthesis occurred.\n")

    # Sort by engagement (highest first) to prioritize best-performing content
    sorted_posts = sorted(
        payload.posts, key=lambda post: sum(post.metrics.values()), reverse=True
    )

    for i, post in enumerate(sorted_posts):
        text = post.text.strip()
        if not text:
            continue
        metrics = post.metrics
        engagement = (
            " | ".join(f"{k}={v}" for k, v in metrics.items() if v) if metrics else "no metrics"
        )
        lines.append(f"\n## Post {i + 1} ({engagement})")
        lines.append(f"{text}\n")

    # Save to file
    path = style_dir / f"{payload.platform}.md"
    path.write_text("\n".join(lines))

    logger.info(
        "[training] Imported %d %s style examples into %s",
        len(payload.posts),
        payload.platform,
        path,
    )

    return {
        "status": "saved",
        "platform": payload.platform,
        "posts_imported": len(sorted_posts),
        "file": str(path),
    }


@router.get("/training/style-learn/{platform}")
def get_imported_style_context(
    platform: Literal["x", "linkedin", "facebook", "instagram", "threads"],
    _role: str = Depends(require_owner),
):
    """Get imported raw style examples for a platform."""
    style_dir = data_path(get_settings(), "style_learning")
    path = style_dir / f"{platform}.md"
    if not path.exists():
        return {"platform": platform, "imported": False, "content": ""}
    return {"platform": platform, "imported": True, "content": path.read_text()}


class PlatformStyleRequest(BaseModel):
    platform: Literal["x", "linkedin", "facebook", "instagram", "threads", "general"]
    style_description: str = Field(min_length=1)


@router.get("/training/platform-styles")
def list_platform_styles(
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    """Get all platform style descriptions."""
    from sqlalchemy import text as sql_text

    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    rows = db.execute(
        sql_text(
            "SELECT platform, style_description, updated_at FROM platform_styles WHERE workspace_id = :wid"
        ),
        {"wid": str(workspace.id)},
    ).fetchall()
    return {
        r[0]: {"description": r[1], "updated_at": r[2].isoformat() if r[2] else None} for r in rows
    }


@router.put("/training/platform-styles/{platform}")
def save_platform_style(
    platform: Literal["x", "linkedin", "facebook", "instagram", "threads", "general"],
    payload: PlatformStyleRequest,
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    """Save a platform-specific style description."""
    from sqlalchemy import text as sql_text

    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    if payload.platform != platform:
        raise HTTPException(status_code=422, detail="Path and body platforms must match")

    # Upsert
    db.execute(
        sql_text(
            """INSERT INTO platform_styles (workspace_id, platform, style_description, updated_at)
           VALUES (:wid, :platform, :desc, now())
           ON CONFLICT (workspace_id, platform) DO UPDATE SET style_description = :desc, updated_at = now()"""
        ),
        {"wid": str(workspace.id), "platform": platform, "desc": payload.style_description},
    )
    db.commit()
    return {"status": "saved", "platform": platform}
