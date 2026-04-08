"""
Training — learn from user preferences through practice and feedback.
- Generate sample content for user to rate/correct
- Analyze past corrections and produce recommendations
- Store recommendations as persistent .md files the agent uses
"""
import json
import logging
from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

import httpx

from rebel_forge_backend.api.auth import require_owner
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.db.models import ContentDraft
from rebel_forge_backend.db.session import get_db
from rebel_forge_backend.services.corrections import get_corrections_context, store_correction
from rebel_forge_backend.services.workspace import WorkspaceService

logger = logging.getLogger("rebel_forge_backend.training")

router = APIRouter()

PROMPTS_DIR = Path(__file__).resolve().parents[4] / "prompts"
TRAINING_DIR = Path(__file__).resolve().parents[4] / "backend" / "data" / "training"


def _load_prompt(name: str) -> str:
    path = PROMPTS_DIR / f"{name}.md"
    return path.read_text().strip() if path.exists() else ""


class TrainingSample(BaseModel):
    """A sample the agent generated for the user to rate."""
    platform: str = "x"
    topic: str = ""
    product_id: str | None = None  # Link to a product/topic


class TrainingFeedback(BaseModel):
    """User feedback on a training sample."""
    original: str
    corrected: str
    feedback: str = ""  # User comment: "too buzzy", "avoid emojis", "more hype"
    platform: str = "x"
    topic: str = ""
    product_id: str | None = None
    rating: int = 3  # 1-5, 3 = neutral


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
        db=db, settings=settings, mode="training",
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
Topic: {payload.topic or 'anything relevant to the brand'}
{product_context}

Return ONLY the post text, nothing else. No JSON, no explanation. Just the caption with hashtags."""

    from rebel_forge_backend.services.llm_config import get_active_llm
    llm = get_active_llm(db, settings)

    try:
        # Codex CLI path — use subprocess
        if llm.provider == "codex":
            import asyncio
            from rebel_forge_backend.services.codex_agent import run_codex
            result = asyncio.run(run_codex(prompt=prompt, system_prompt="You generate social media posts. Return only the post text.", model=llm.model if llm.model != "codex" else None))
            text = result.text or ""
            if result.error:
                raise RuntimeError(result.error)
        else:
            with httpx.Client(timeout=None) as client:
                headers = {"Content-Type": "application/json"}
                if llm.api_key:
                    headers["Authorization"] = f"Bearer {llm.api_key}"

                r = client.post(
                    f"{llm.base_url}/responses",
                    headers=headers,
                    json={
                        "model": llm.model,
                        "instructions": "You generate social media posts. Return only the post text.",
                        "input": [{"role": "user", "content": prompt}],
                        "max_output_tokens": 500,
                    },
                )
                data = r.json()

            text = ""
            for item in data.get("output", []):
                if item.get("type") == "message":
                    for part in item.get("content", []):
                        if part.get("type") == "output_text":
                            text = part.get("text", "")

        return {
            "sample": text.strip(),
            "platform": payload.platform,
            "topic": payload.topic,
            "product_id": payload.product_id,
        }

    except Exception as e:
        logger.error("[training] Sample generation failed: %s", e)
        return {"sample": None, "error": str(e)}


@router.get("/training/corrections")
def list_training_corrections(
    limit: int = 50,
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

    had_edits = payload.original != payload.corrected
    if True:  # Always save — rating alone is useful feedback
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
        {"concept": d.concept, "platform": d.platform, "status": d.status if isinstance(d.status, str) else d.status.value}
        for d in recent_drafts
    ]

    training_prompt = _load_prompt("training")
    context = f"""Brand voice: {bp.voice_summary or 'not set'}
Audience: {bp.audience_summary or 'not set'}
Goals: {bp.goals}

Past corrections ({corrections_count} total):
{corrections or 'No corrections yet — the agent has no training data.'}

Recent drafts ({len(drafts_summary)} total):
{json.dumps(drafts_summary[:10], indent=2)}
"""

    from rebel_forge_backend.services.llm_config import get_active_llm
    llm = get_active_llm(db, settings)

    try:
        if llm.provider == "codex":
            import asyncio
            from rebel_forge_backend.services.codex_agent import run_codex
            full_prompt = f"{training_prompt}\n\n{context}"
            result = asyncio.run(run_codex(prompt=full_prompt, system_prompt="You analyze content patterns and return JSON recommendations.", model=llm.model if llm.model != "codex" else None))
            text = result.text or ""
            if result.error:
                raise RuntimeError(result.error)
        else:
            with httpx.Client(timeout=None) as client:
                headers = {"Content-Type": "application/json"}
                if llm.api_key:
                    headers["Authorization"] = f"Bearer {llm.api_key}"

                r = client.post(
                    f"{llm.base_url}/responses",
                    headers=headers,
                    json={
                        "model": llm.model,
                        "instructions": training_prompt,
                        "input": [{"role": "user", "content": context}],
                        "max_output_tokens": 1000,
                    },
                )
                data = r.json()

            text = ""
            for item in data.get("output", []):
                if item.get("type") == "message":
                    for part in item.get("content", []):
                        if part.get("type") == "output_text":
                            text = part.get("text", "")

        # Parse JSON — try extraction, fall back to structured summary
        recommendations = {}
        try:
            start = text.find("{")
            end = text.rfind("}") + 1
            if start >= 0 and end > start:
                recommendations = json.loads(text[start:end])
        except json.JSONDecodeError:
            pass

        if not recommendations or "raw" in recommendations:
            # LLM didn't return JSON — extract insights from text
            recommendations = {
                "tone_patterns": ["Direct, no-fluff writing style"] if "direct" in text.lower() else [],
                "avoid": [line.strip("- ").strip() for line in text.split("\n") if "avoid" in line.lower() or "jargon" in line.lower() or "remove" in line.lower()][:5],
                "prefer": [line.strip("- ").strip() for line in text.split("\n") if "prefer" in line.lower() or "use" in line.lower() or "keep" in line.lower()][:5],
                "analysis": text[:500],
                "confidence": "medium" if corrections_count >= 5 else "low",
            }

        # Save recommendations to file for future use
        TRAINING_DIR.mkdir(parents=True, exist_ok=True)
        recs_path = TRAINING_DIR / f"{workspace.id}_recommendations.json"
        recs_path.write_text(json.dumps(recommendations, indent=2))
        logger.info("[training] Recommendations saved to %s", recs_path)

        return RecommendationResponse(
            recommendations=recommendations,
            corrections_count=corrections_count,
            drafts_analyzed=len(drafts_summary),
        )

    except Exception as e:
        logger.error("[training] Recommendations failed: %s", e)
        return RecommendationResponse(
            recommendations={"error": str(e)},
            corrections_count=corrections_count,
            drafts_analyzed=len(drafts_summary),
        )


@router.get("/training/status")
def training_status(db: Session = Depends(get_db), _role: str = Depends(require_owner)):
    """Get training data status — how much the agent has learned."""
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)

    from rebel_forge_backend.services.corrections import get_corrections_count
    corrections_count = get_corrections_count(db, workspace.id)

    draft_count = db.scalar(
        select(ContentDraft)
        .where(ContentDraft.workspace_id == workspace.id)
        .with_only_columns(ContentDraft.id)
        .order_by(ContentDraft.created_at.desc())
        .limit(1)
    )

    total_drafts = db.execute(
        select(ContentDraft).where(ContentDraft.workspace_id == workspace.id)
    ).all()

    # Check if recommendations exist
    TRAINING_DIR.mkdir(parents=True, exist_ok=True)
    recs_path = TRAINING_DIR / f"{workspace.id}_recommendations.json"
    has_recommendations = recs_path.exists()

    # Check style learning files
    style_dir = Path(__file__).resolve().parents[4] / "backend" / "data" / "style_learning"
    style_platforms = []
    if style_dir.exists():
        style_platforms = [f.stem for f in style_dir.glob("*.md") if f.stat().st_size > 0]

    return {
        "corrections_count": corrections_count,
        "total_drafts": len(total_drafts),
        "has_recommendations": has_recommendations,
        "training_level": "none" if corrections_count == 0 else "basic" if corrections_count < 5 else "moderate" if corrections_count < 20 else "strong",
        "style_learned_platforms": style_platforms,
    }


class StyleLearnRequest(BaseModel):
    platform: str
    posts: list[dict]  # [{text, metrics: {likes, impressions, ...}, created_at}]


@router.post("/training/style-learn")
def learn_from_posts(
    payload: StyleLearnRequest,
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    """Learn tone and style from fetched platform posts. Saves as a style reference file."""
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)

    style_dir = Path(__file__).resolve().parents[4] / "backend" / "data" / "style_learning"
    style_dir.mkdir(parents=True, exist_ok=True)

    # Build the style reference from the posts
    lines = [f"# Style Reference — {payload.platform.upper()}\n"]
    lines.append(f"Learned from {len(payload.posts)} posts on {payload.platform}.\n")
    lines.append("The user's actual writing style on this platform:\n")

    # Sort by engagement (highest first) to prioritize best-performing content
    sorted_posts = sorted(payload.posts, key=lambda p: sum((p.get("metrics") or {}).values()), reverse=True)

    for i, post in enumerate(sorted_posts[:30]):  # cap at 30 posts
        text = post.get("text", "").strip()
        if not text:
            continue
        metrics = post.get("metrics", {})
        engagement = " | ".join(f"{k}={v}" for k, v in metrics.items() if v) if metrics else "no metrics"
        lines.append(f"\n## Post {i+1} ({engagement})")
        lines.append(f"{text[:500]}\n")

    # Save to file
    path = style_dir / f"{payload.platform}.md"
    path.write_text("\n".join(lines))

    logger.info("[training] Style learned from %d %s posts → %s", len(payload.posts), payload.platform, path)

    return {"status": "saved", "platform": payload.platform, "posts_analyzed": len(sorted_posts[:30]), "file": str(path)}


@router.get("/training/style-learn/{platform}")
def get_style_learning(
    platform: str,
    _role: str = Depends(require_owner),
):
    """Get the saved style learning data for a platform."""
    style_dir = Path(__file__).resolve().parents[4] / "backend" / "data" / "style_learning"
    path = style_dir / f"{platform}.md"
    if not path.exists():
        return {"platform": platform, "learned": False, "content": ""}
    return {"platform": platform, "learned": True, "content": path.read_text()}


class PlatformStyleRequest(BaseModel):
    platform: str
    style_description: str


@router.get("/training/platform-styles")
def list_platform_styles(
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    """Get all platform style descriptions."""
    from sqlalchemy import text as sql_text
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    rows = db.execute(sql_text(
        "SELECT platform, style_description, updated_at FROM platform_styles WHERE workspace_id = :wid"
    ), {"wid": str(workspace.id)}).fetchall()
    return {r[0]: {"description": r[1], "updated_at": r[2].isoformat() if r[2] else None} for r in rows}


@router.put("/training/platform-styles/{platform}")
def save_platform_style(
    platform: str,
    payload: PlatformStyleRequest,
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    """Save a platform-specific style description."""
    from sqlalchemy import text as sql_text
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)

    # Upsert
    db.execute(sql_text(
        """INSERT INTO platform_styles (workspace_id, platform, style_description, updated_at)
           VALUES (:wid, :platform, :desc, now())
           ON CONFLICT (workspace_id, platform) DO UPDATE SET style_description = :desc, updated_at = now()"""
    ), {"wid": str(workspace.id), "platform": platform, "desc": payload.style_description})
    db.commit()
    return {"status": "saved", "platform": platform}
