"""
Heartbeat service — the autonomous engine.

Runs on a configurable schedule. Each cycle:
1. Scout: researches trends and opportunities (via web search + LLM)
2. Analyst: reviews recent post performance (if published posts exist)
3. Creator: generates new drafts based on scout + analyst output
4. Notifier: alerts the user if there's something to review

The heartbeat is NOT a cron job. It's a loop in the worker process
that checks if enough time has passed since the last run.
"""
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import httpx
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from rebel_forge_backend.core.config import Settings
from rebel_forge_backend.db.models import (
    ContentDraft,
    DraftStatus,
    Event,
    JobType,
    PublishedPost,
)
from rebel_forge_backend.providers.search.firecrawl import FirecrawlProvider
from rebel_forge_backend.services.jobs import JobService

logger = logging.getLogger("rebel_forge_backend.heartbeat")

PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts"


def load_prompt(name: str) -> str:
    path = PROMPTS_DIR / f"{name}.md"
    if path.exists():
        return path.read_text().strip()
    return ""


class HeartbeatService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _get_llm(self, db: Session):
        """Resolve active LLM config."""
        from rebel_forge_backend.services.llm_config import get_active_llm
        return get_active_llm(db, self.settings)

    def should_run(self, db: Session, workspace_id: str, interval_hours: int = 6) -> bool:
        """Check if enough time has passed since the last heartbeat."""
        last_event = db.scalars(
            select(Event)
            .where(Event.workspace_id == workspace_id)
            .where(Event.event_type == "heartbeat.completed")
            .order_by(Event.created_at.desc())
            .limit(1)
        ).first()

        if last_event is None:
            return True

        elapsed = (datetime.now(timezone.utc) - last_event.created_at).total_seconds()
        return elapsed >= (interval_hours * 3600)

    def run(self, db: Session, workspace) -> dict:
        """Execute one full heartbeat cycle. Always records completion, even on failure."""
        logger.info("[heartbeat] Starting cycle for workspace %s", workspace.name)
        from rebel_forge_backend.services.events import record_event as _record

        result = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "scout": None,
            "analyst": None,
            "drafts_created": 0,
        }

        # Step 1: Scout — research trends
        from rebel_forge_backend.services.events import record_event
        record_event(db, workspace_id=workspace.id, entity_type="heartbeat", entity_id=workspace.id,
                     event_type="heartbeat.scout.started", payload={"step": "scout"})
        db.commit()

        try:
            scout_brief = self._run_scout(db, workspace)
            result["scout"] = scout_brief
            logger.info("[heartbeat] Scout completed: %d trends found", len(scout_brief.get("trends", [])))
            record_event(db, workspace_id=workspace.id, entity_type="heartbeat", entity_id=workspace.id,
                         event_type="heartbeat.scout.completed", payload={"trends": scout_brief.get("trends", [])[:5]})
            db.commit()
        except Exception as e:
            logger.error("[heartbeat] Scout failed: %s", e)
            result["scout"] = {"error": str(e)}
            record_event(db, workspace_id=workspace.id, entity_type="heartbeat", entity_id=workspace.id,
                         event_type="heartbeat.scout.failed", payload={"error": str(e)})
            db.commit()

        # Step 2: Analyst — review performance (only if published posts exist)
        published_count = db.scalar(
            select(func.count())
            .select_from(PublishedPost)
            .where(PublishedPost.workspace_id == workspace.id)
        )
        if published_count and published_count > 0:
            record_event(db, workspace_id=workspace.id, entity_type="heartbeat", entity_id=workspace.id,
                         event_type="heartbeat.analyst.started", payload={"step": "analyst"})
            db.commit()

            try:
                analysis = self._run_analyst(db, workspace)
                result["analyst"] = analysis
                logger.info("[heartbeat] Analyst completed")
                record_event(db, workspace_id=workspace.id, entity_type="heartbeat", entity_id=workspace.id,
                             event_type="heartbeat.analyst.completed", payload={"summary": analysis.get("summary", "")})
                db.commit()
            except Exception as e:
                logger.error("[heartbeat] Analyst failed: %s", e)
                result["analyst"] = {"error": str(e)}
                record_event(db, workspace_id=workspace.id, entity_type="heartbeat", entity_id=workspace.id,
                             event_type="heartbeat.analyst.failed", payload={"error": str(e)})
                db.commit()

        # Step 3: Creator — generate drafts based on scout + analyst
        record_event(db, workspace_id=workspace.id, entity_type="heartbeat", entity_id=workspace.id,
                     event_type="heartbeat.creator.started", payload={"step": "creator"})
        db.commit()

        try:
            brief = self._build_creator_brief(workspace, result["scout"], result["analyst"])
            job = JobService().enqueue_job(
                db,
                workspace_id=workspace.id,
                job_type=JobType.DRAFT_GENERATION,
                input_payload={
                    "platform": self._get_primary_platform(workspace),
                    "objective": "increase engagement",
                    "count": 2,
                    "brief": brief,
                },
            )
            result["drafts_created"] = 2
            result["job_id"] = str(job.id)
            logger.info("[heartbeat] Creator job queued: %s", job.id)
        except Exception as e:
            logger.error("[heartbeat] Creator failed: %s", e)

        # Record heartbeat event
        from rebel_forge_backend.services.events import record_event
        record_event(
            db,
            workspace_id=workspace.id,
            entity_type="workspace",
            entity_id=workspace.id,
            event_type="heartbeat.completed",
            payload=result,
        )
        db.commit()

        logger.info("[heartbeat] Cycle completed")
        return result

    def _run_scout(self, db: Session, workspace) -> dict:
        """Scout agent: research trends using web search + LLM."""
        bp = workspace.brand_profile
        niche = bp.voice_summary or "general" if bp else "general"
        audience = bp.audience_summary or "general audience" if bp else "general audience"
        platform = self._get_primary_platform(workspace)

        # Web search for trends
        search_results = []
        if self.settings.firecrawl_api_key:
            try:
                fc = FirecrawlProvider(self.settings)
                search_results = fc.search(
                    f"{niche} {platform} content trends {datetime.now().strftime('%B %Y')}",
                    limit=5,
                )
                logger.info("[scout] Found %d search results", len(search_results))
            except Exception as e:
                logger.warning("[scout] Web search failed: %s", e)

        # Build scout prompt with unified context
        scout_prompt = load_prompt("scout")
        from rebel_forge_backend.services.context_builder import build_context, get_mode_description
        unified_context = build_context(
            db=db, settings=self.settings, mode="heartbeat",
            mode_description=get_mode_description("heartbeat"),
        )
        context = f"""{unified_context}

Current scout task — Platform: {platform}

Recent web search results:
{json.dumps([{"title": r.get("title", ""), "description": r.get("description", "")} for r in search_results[:5]], indent=2)}
"""

        # Call LLM
        llm = self._get_llm(db)
        with httpx.Client(timeout=None) as client:
            headers = {"Content-Type": "application/json"}
            if llm.api_key:
                headers["Authorization"] = f"Bearer {llm.api_key}"

            response = client.post(
                f"{llm.base_url}/responses",
                headers=headers,
                json={
                    "model": llm.model,
                    "instructions": scout_prompt,
                    "input": [{"role": "user", "content": context}],
                    "max_output_tokens": 600,
                },
            )
            data = response.json()

        # Extract text from response
        text = self._extract_text(data)
        try:
            # Try to parse as JSON
            json_match = text[text.find("{"):text.rfind("}") + 1]
            return json.loads(json_match)
        except (json.JSONDecodeError, ValueError):
            return {"raw": text, "trends": [], "content_opportunities": []}

    def _run_analyst(self, db: Session, workspace) -> dict:
        """Analyst agent: review recent post performance."""
        # Get recent drafts (published and others for comparison)
        recent_drafts = db.scalars(
            select(ContentDraft)
            .where(ContentDraft.workspace_id == workspace.id)
            .order_by(ContentDraft.created_at.desc())
            .limit(10)
        ).all()

        draft_summary = [
            {
                "concept": d.concept,
                "platform": d.platform,
                "status": d.status if isinstance(d.status, str) else d.status.value,
                "hashtags": d.hashtags[:5],
            }
            for d in recent_drafts
        ]

        analyst_prompt = load_prompt("analyst")
        context = f"""
Recent content (last 10 items):
{json.dumps(draft_summary, indent=2)}

Brand goals: {workspace.brand_profile.goals if workspace.brand_profile else {}}
"""

        llm = self._get_llm(db)
        with httpx.Client(timeout=None) as client:
            headers = {"Content-Type": "application/json"}
            if llm.api_key:
                headers["Authorization"] = f"Bearer {llm.api_key}"

            response = client.post(
                f"{llm.base_url}/responses",
                headers=headers,
                json={
                    "model": llm.model,
                    "instructions": analyst_prompt,
                    "input": [{"role": "user", "content": context}],
                    "max_output_tokens": 600,
                },
            )
            data = response.json()

        text = self._extract_text(data)
        try:
            json_match = text[text.find("{"):text.rfind("}") + 1]
            return json.loads(json_match)
        except (json.JSONDecodeError, ValueError):
            return {"raw": text, "summary": "Analysis completed"}

    def _build_creator_brief(self, workspace, scout: dict | None, analyst: dict | None) -> str:
        """Build a brief for the creator based on scout and analyst output."""
        parts = []

        if scout and not scout.get("error"):
            trends = scout.get("trends", [])
            opportunities = scout.get("content_opportunities", [])
            if trends:
                parts.append(f"Trending topics: {', '.join(trends[:3])}")
            if opportunities:
                parts.append(f"Content ideas: {', '.join(opportunities[:3])}")

        if analyst and not analyst.get("error"):
            exploit = analyst.get("exploit", [])
            explore = analyst.get("explore", [])
            if exploit:
                parts.append(f"Double down on: {', '.join(exploit[:2])}")
            if explore:
                parts.append(f"Experiment with: {', '.join(explore[:1])}")

        bp = workspace.brand_profile
        if bp and bp.voice_summary:
            parts.append(f"Brand voice: {bp.voice_summary}")

        if not parts:
            parts.append("Create engaging content that fits the brand")

        return ". ".join(parts)

    def _get_primary_platform(self, workspace) -> str:
        """Get the primary platform from brand profile or default."""
        bp = workspace.brand_profile
        if bp and bp.style_notes:
            platform = bp.style_notes.get("platform", "")
            if platform:
                return platform
        return "x"

    @staticmethod
    def _extract_text(response_data: dict) -> str:
        """Extract text content from a Responses API response."""
        for item in response_data.get("output", []):
            if item.get("type") == "message":
                for part in item.get("content", []):
                    if part.get("type") == "output_text":
                        return part.get("text", "")
        return ""
