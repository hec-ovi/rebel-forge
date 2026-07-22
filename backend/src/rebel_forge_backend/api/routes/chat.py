import json
import logging
from typing import Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from rebel_forge_backend.api.auth import require_owner
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.core.paths import data_path, prompts_path
from rebel_forge_backend.db.models import JobType
from rebel_forge_backend.db.session import get_db
from rebel_forge_backend.providers.search.firecrawl import FirecrawlProvider
from rebel_forge_backend.services.jobs import JobService
from rebel_forge_backend.services.workspace import WorkspaceService

logger = logging.getLogger("rebel_forge_backend.chat")

router = APIRouter()

CHAT_TOOLS = [
    {
        "type": "function",
        "name": "generate_drafts",
        "description": "Generate social media draft posts for review. This tool never approves or publishes content.",
        "parameters": {
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "Describe the draft generation action.",
                },
                "platform": {
                    "type": "string",
                    "description": "Social platform: x, instagram, linkedin, threads",
                },
                "count": {"type": "integer", "description": "Number of drafts (1-7)"},
                "brief": {"type": "string", "description": "What the posts should be about"},
                "objective": {
                    "type": "string",
                    "description": "Goal: increase engagement, grow followers, etc.",
                },
                "generate_image": {
                    "type": "boolean",
                    "description": "If true, generate image for each draft. Default: true for instagram, false for others.",
                },
            },
            "required": ["summary", "platform", "count", "brief"],
        },
    },
    {
        "type": "function",
        "name": "web_search",
        "description": "Search the web for current information. Use when the user asks about trends, news, competition, or anything needing real-time data.",
        "parameters": {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "Describe the search action."},
                "query": {"type": "string", "description": "Search query"},
            },
            "required": ["summary", "query"],
        },
    },
    {
        "type": "function",
        "name": "update_brand",
        "description": "Update the brand profile. Use when the user describes their brand voice, audience, or goals.",
        "parameters": {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "Describe the brand update."},
                "voice_summary": {"type": "string"},
                "audience_summary": {"type": "string"},
                "goals": {"type": "string"},
            },
            "required": ["summary"],
        },
    },
    {
        "type": "function",
        "name": "run_heartbeat",
        "description": "Run a full heartbeat cycle: scout researches trends, analyst reviews performance, creator generates drafts. Use when the user says 'run heartbeat', 'check for content', 'what should I post', or 'do a full cycle'.",
        "parameters": {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "Describe the heartbeat action."},
            },
            "required": ["summary"],
        },
    },
    {
        "type": "function",
        "name": "save_onboarding",
        "description": "Save the onboarding summary after all 7 questions are answered. Call this tool with the collected data instead of printing JSON.",
        "parameters": {
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "Summarize the brand setup being saved.",
                },
                "platforms": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Platforms the user is active on",
                },
                "content_types": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Types of content they create",
                },
                "frequency": {"type": "string", "description": "How often they post"},
                "audience": {"type": "string", "description": "Their target audience"},
                "voice": {"type": "string", "description": "Their brand tone/voice"},
                "goals": {"type": "string", "description": "Their main goal"},
                "inspiration": {"type": "string", "description": "Accounts they admire"},
            },
            "required": ["summary", "platforms", "voice", "goals"],
        },
    },
    {
        "type": "function",
        "name": "setup_platform",
        "description": "Generate a complete platform profile: bio, description, handle suggestions, topics, and first 3 post ideas. Use when user says 'set up my instagram', 'help me create my linkedin profile', 'build my X profile', etc.",
        "parameters": {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "Describe the platform setup action."},
                "platform": {
                    "type": "string",
                    "description": "Platform to set up: x, instagram, linkedin, facebook, threads",
                },
                "niche": {
                    "type": "string",
                    "description": "What the account is about (e.g. 'AI engineering', 'fitness coaching', 'restaurant')",
                },
            },
            "required": ["summary", "platform"],
        },
    },
    {
        "type": "function",
        "name": "query_drafts",
        "description": "List or count drafts and published posts using workspace-scoped filters. Use when the user asks about past posts, published content, or draft counts.",
        "parameters": {
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "Describe what you are querying. Example: 'Fetching published X posts'",
                },
                "resource": {
                    "type": "string",
                    "enum": ["drafts", "published_posts"],
                    "description": "Content resource to query. Defaults to drafts.",
                },
                "operation": {"type": "string", "enum": ["list", "count"]},
                "platform": {"type": "string"},
                "status": {
                    "type": "string",
                    "enum": ["draft", "reviewed", "approved", "scheduled", "published", "failed"],
                },
                "search": {"type": "string", "description": "Text to find in content fields."},
                "limit": {"type": "integer", "minimum": 1, "maximum": 50},
            },
            "required": ["summary"],
        },
    },
    {
        "type": "function",
        "name": "generate_image",
        "description": "Generate or attach an image to an existing draft. Use when the user wants to add an image, regenerate an image, or create a visual for a post. If no prompt is provided, one will be auto-generated from the draft content.",
        "parameters": {
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "Describe the image generation action.",
                },
                "draft_id": {
                    "type": "string",
                    "description": "UUID of the draft. If not provided, uses the most recent draft.",
                },
                "prompt": {
                    "type": "string",
                    "description": "Image generation prompt. If omitted, auto-generated from draft content.",
                },
            },
            "required": ["summary"],
        },
    },
    {
        "type": "function",
        "name": "recall_training",
        "description": "Recall saved corrections, voice guidance, and imported raw style examples for a platform before generating content.",
        "parameters": {
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "Describe the training recall action.",
                },
                "platform": {
                    "type": "string",
                    "description": "Platform to recall training for: x, instagram, linkedin, threads, facebook",
                },
            },
            "required": ["summary", "platform"],
        },
    },
]


def load_prompt(name: str) -> str:
    path = prompts_path(get_settings(), f"{name}.md")
    if path.exists():
        return path.read_text().strip()
    return "You are a helpful assistant."


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)

    @field_validator("content")
    @classmethod
    def reject_blank_content(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Message content cannot be blank")
        return value


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=100)
    mode: Literal["general", "onboarding"] = "general"


def _execute_tool(tool_name: str, arguments: dict, settings, db: Session, workspace) -> dict:
    """Execute a tool call server-side and return the result."""
    logger.info("[tool_call] %s(%s)", tool_name, json.dumps(arguments, default=str)[:200])

    # Log to events table
    from rebel_forge_backend.services.events import record_event

    record_event(
        db,
        workspace_id=workspace.id,
        entity_type="chat",
        entity_id=workspace.id,
        event_type=f"chat.tool.{tool_name}",
        payload={"arguments": arguments},
    )
    db.commit()

    if tool_name == "generate_drafts":
        from rebel_forge_backend.schemas.drafts import DraftGenerationRequest

        platform = str(arguments.get("platform", "instagram")).lower()
        count = min(max(int(arguments.get("count", 2)), 1), 7)
        brief = str(arguments.get("brief", "general content"))
        objective = str(arguments.get("objective", "increase engagement"))
        generate_image = arguments.get("generate_image")  # None = platform default

        request = DraftGenerationRequest(
            platform=platform,
            count=count,
            brief=brief,
            objective=objective,
            auto_approve=False,
            generate_image=generate_image,
        )
        job = JobService().enqueue_job(
            db,
            workspace_id=workspace.id,
            job_type=JobType.DRAFT_GENERATION,
            input_payload=request.model_dump(mode="json"),
        )
        logger.info(
            "[tool_result] generate_drafts → job %s queued (%d %s drafts)", job.id, count, platform
        )
        return {
            "type": "generate",
            "status": "queued",
            "job_id": str(job.id),
            "message": f"Generating {count} {platform} drafts for review...",
            "count": count,
            "platform": platform,
            "auto_approve": False,
        }

    elif tool_name == "web_search":
        query = str(arguments.get("query", ""))
        if not query:
            return {"type": "search", "status": "error", "message": "No query provided"}
        try:
            fc = FirecrawlProvider(settings)
            raw = fc.search(query, limit=5)
            results = [
                {
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "description": r.get("description", ""),
                }
                for r in raw
                if r.get("url")
            ]
            logger.info("[tool_result] web_search → %d results for '%s'", len(results), query)
            return {"type": "search", "status": "completed", "results": results, "query": query}
        except Exception as e:
            logger.error("[tool_error] web_search failed: %s", e)
            return {"type": "search", "status": "error", "message": str(e)}

    elif tool_name == "update_brand":
        try:
            ws_service = WorkspaceService(settings)
            ws_service.update_brand_profile(
                db,
                workspace=workspace,
                voice_summary=arguments.get("voice_summary"),
                audience_summary=arguments.get("audience_summary"),
                goals={"primary": arguments.get("goals", "")} if arguments.get("goals") else None,
                style_notes=None,
                reference_examples=None,
            )
            logger.info("[tool_result] update_brand → saved")
            return {
                "type": "update_brand",
                "status": "completed",
                "message": "Brand profile updated.",
            }
        except Exception as e:
            logger.error("[tool_error] update_brand failed: %s", e)
            return {"type": "update_brand", "status": "error", "message": str(e)}

    elif tool_name in {"approve_draft", "publish_draft"}:
        return {
            "type": "approve" if tool_name == "approve_draft" else "publish",
            "status": "error",
            "message": (
                "Approving and publishing require an explicit action in the authenticated drafts UI."
            ),
        }

    elif tool_name == "run_heartbeat":
        try:
            from rebel_forge_backend.services.events import record_event

            # Don't run synchronously — signal the worker to run it
            record_event(
                db,
                workspace_id=workspace.id,
                entity_type="workspace",
                entity_id=workspace.id,
                event_type="heartbeat.requested",
                payload={"triggered_by": "chat"},
            )
            db.commit()
            logger.info("[tool_result] run_heartbeat → queued for worker")
            return {
                "type": "heartbeat",
                "status": "completed",
                "message": "Heartbeat cycle queued. Scout will research trends, then drafts will be generated. Check back in 2-3 minutes.",
            }
        except Exception as e:
            logger.error("[tool_error] run_heartbeat failed: %s", e)
            return {"type": "heartbeat", "status": "error", "message": str(e)}

    elif tool_name == "save_onboarding":
        try:
            ws_service = WorkspaceService(settings)
            platforms = arguments.get("platforms", [])
            voice = str(arguments.get("voice", ""))
            audience = str(arguments.get("audience", ""))
            goals = str(arguments.get("goals", ""))
            frequency = str(arguments.get("frequency", ""))
            content_types = arguments.get("content_types", [])
            inspiration = str(arguments.get("inspiration", ""))

            ws_service.update_brand_profile(
                db,
                workspace=workspace,
                voice_summary=voice,
                audience_summary=audience,
                goals={"primary": goals, "platforms": platforms},
                style_notes={
                    "tone": voice.split(",") if "," in voice else [voice],
                    "content_types": content_types
                    if isinstance(content_types, list)
                    else [content_types],
                    "frequency": frequency,
                    "inspiration": inspiration,
                },
                reference_examples=inspiration.split(",")
                if "," in inspiration
                else [inspiration]
                if inspiration
                else [],
            )
            logger.info("[tool_result] save_onboarding → saved")
            return {
                "type": "save_onboarding",
                "status": "completed",
                "message": "Brand profile saved! Your content engine is ready.",
                "profile": {
                    "platforms": platforms,
                    "content_types": content_types,
                    "frequency": frequency,
                    "audience": audience,
                    "voice": voice,
                    "goals": goals,
                    "inspiration": inspiration,
                },
            }
        except Exception as e:
            logger.error("[tool_error] save_onboarding failed: %s", e)
            return {"type": "save_onboarding", "status": "error", "message": str(e)}

    elif tool_name == "setup_platform":
        platform = str(arguments.get("platform", "")).lower()
        niche = str(arguments.get("niche", ""))

        if not platform:
            return {
                "type": "setup_platform",
                "status": "error",
                "message": "No platform specified.",
            }
        supported_platforms = {"x", "linkedin", "facebook", "instagram", "threads"}
        aliases = {"twitter": "x", "fb": "facebook", "ig": "instagram"}
        platform = aliases.get(platform.strip(), platform.strip())
        if platform not in supported_platforms:
            return {
                "type": "setup_platform",
                "status": "error",
                "message": f"Unsupported platform: {platform}",
            }

        # Use brand profile for context if niche not provided
        bp = workspace.brand_profile
        if not niche and bp:
            niche = bp.voice_summary or bp.audience_summary or ""

        setup_prompt = load_prompt("setup_platform")
        context = f"Platform: {platform}\nNiche/Brand: {niche or 'general'}"

        if bp:
            context += f"\nBrand voice: {bp.voice_summary or 'not set'}"
            context += f"\nAudience: {bp.audience_summary or 'not set'}"
            context += f"\nGoals: {bp.goals}"

        try:
            from rebel_forge_backend.services.text_generation import generate_text

            text = generate_text(
                db,
                settings,
                instructions=setup_prompt,
                prompt=(
                    f"{context}\n\nReturn a JSON object with: display_name, handle, bio, "
                    "topics, content_strategy, and first_posts (an array of up to 3 objects "
                    "with concept, caption, hashtags, and media_prompt)."
                ),
            )

            # Try to parse JSON from the response
            profile_data = None
            try:
                # Find JSON block
                start = text.find("{")
                end = text.rfind("}") + 1
                if start >= 0 and end > start:
                    profile_data = json.loads(text[start:end])
            except json.JSONDecodeError:
                pass

            if isinstance(profile_data, dict):
                # Save to platform profile
                from rebel_forge_backend.api.routes.platforms import PlatformProfile

                profile = PlatformProfile(
                    display_name=profile_data.get("display_name", ""),
                    handle=profile_data.get("handle", ""),
                    bio=profile_data.get("bio", ""),
                    topics=profile_data.get("topics", ""),
                    auto_images=False,
                )
                style = dict(bp.style_notes or {}) if bp else {}
                profiles = dict(style.get("platform_profiles", {}))
                profiles[platform] = profile.model_dump()
                style["platform_profiles"] = profiles
                if bp:
                    bp.style_notes = style
                    db.commit()

                # Also queue draft generation for the first 3 posts
                raw_first_posts = profile_data.get("first_posts", [])
                first_posts = (
                    [post for post in raw_first_posts if isinstance(post, dict)][:3]
                    if isinstance(raw_first_posts, list)
                    else []
                )
                if first_posts:
                    briefs = [str(p.get("concept", "")).strip() for p in first_posts]
                    briefs = [brief for brief in briefs if brief]
                    JobService().enqueue_job(
                        db,
                        workspace_id=workspace.id,
                        job_type=JobType.DRAFT_GENERATION,
                        input_payload={
                            "platform": platform,
                            "objective": "launch account with strong first content",
                            "count": len(first_posts),
                            "brief": ". ".join(briefs) or "Starter content",
                        },
                    )

                logger.info("[tool_result] setup_platform → %s profile generated", platform)
                return {
                    "type": "setup_platform",
                    "status": "completed",
                    "message": (
                        f"Profile for {platform} generated. "
                        f"{len(first_posts)} starter post{'s' if len(first_posts) != 1 else ''} queued."
                    ),
                    "profile": profile_data,
                    "starter_posts_queued": len(first_posts),
                }
            else:
                logger.warning("[tool_result] setup_platform → couldn't parse profile JSON")
                return {
                    "type": "setup_platform",
                    "status": "completed",
                    "message": f"Here's the profile suggestion for {platform}:",
                    "raw_text": text,
                }

        except Exception as e:
            logger.error("[tool_error] setup_platform failed: %s", e)
            return {"type": "setup_platform", "status": "error", "message": str(e)}

    elif tool_name == "query_drafts":
        if "sql" in arguments:
            return {
                "type": "query_drafts",
                "status": "error",
                "message": "Raw SQL is not supported. Use structured filters.",
            }
        try:
            from rebel_forge_backend.services.draft_query import query_workspace_content

            query_result = query_workspace_content(
                db,
                workspace_id=workspace.id,
                resource=str(arguments.get("resource", "drafts")),
                operation=str(arguments.get("operation", "list")),
                platform=arguments.get("platform"),
                status=arguments.get("status"),
                search=arguments.get("search"),
                limit=arguments.get("limit", 20),
            )
            total = query_result.get("count", len(query_result.get("results", [])))
            logger.info("[tool_result] query_drafts → %d rows", total)
            return query_result | {
                "type": "query_drafts",
                "status": "completed",
                "message": f"Found {total} results",
            }
        except (TypeError, ValueError) as exc:
            logger.warning("[tool_error] invalid query_drafts request: %s", exc)
            return {"type": "query_drafts", "status": "error", "message": str(exc)}

    elif tool_name == "generate_image":
        from sqlalchemy import select

        from rebel_forge_backend.db.models import ContentDraft

        draft_id = arguments.get("draft_id")
        prompt = arguments.get("prompt")

        try:
            if draft_id:
                from rebel_forge_backend.services.draft_query import get_workspace_draft

                draft = get_workspace_draft(
                    db, workspace_id=workspace.id, draft_id=draft_id
                )
            else:
                query = (
                    select(ContentDraft)
                    .where(ContentDraft.workspace_id == workspace.id)
                    .order_by(ContentDraft.created_at.desc())
                    .limit(1)
                )
                draft = db.scalars(query).first()

            if not draft:
                return {"type": "generate_image", "status": "error", "message": "No draft found."}

            if not prompt:
                prompt = draft.media_prompt or f"Social media image for: {draft.concept[:200]}"

            from rebel_forge_backend.services.orchestration import _detect_media_provider

            media_provider = _detect_media_provider(settings)
            if not media_provider:
                return {
                    "type": "generate_image",
                    "status": "error",
                    "message": "No image provider available (ComfyUI or fal.ai).",
                }

            job = JobService().enqueue_job(
                db,
                workspace_id=workspace.id,
                job_type=JobType.MEDIA_GENERATION,
                input_payload={
                    "prompt": prompt,
                    "size": "1024x1024",
                    "draft_id": str(draft.id),
                    "provider": media_provider,
                },
            )
            logger.info(
                "[tool_result] generate_image → job %s queued for draft %s", job.id, draft.id
            )
            return {
                "type": "generate_image",
                "status": "queued",
                "job_id": str(job.id),
                "draft_id": str(draft.id),
                "message": f"Generating image for '{draft.concept[:50]}'...",
                "prompt": prompt[:100],
            }
        except Exception as e:
            logger.error("[tool_error] generate_image failed: %s", e)
            return {"type": "generate_image", "status": "error", "message": str(e)}

    elif tool_name == "recall_training":
        platform = arguments.get("platform", "")
        supported_platforms = {"x", "linkedin", "facebook", "instagram", "threads"}
        if platform not in supported_platforms:
            return {
                "type": "recall_training",
                "status": "error",
                "message": f"Unsupported platform: {platform}",
            }
        from sqlalchemy import text as sql_text

        from rebel_forge_backend.services.corrections import (
            get_corrections_context,
            get_corrections_count,
            list_corrections,
        )

        # Platform-specific corrections
        corrections_md = get_corrections_context(db, workspace.id, platform=platform)
        get_corrections_count(db, workspace.id)

        # General voice + platform style description
        general_voice = ""
        style_desc = ""
        try:
            gen_row = db.execute(
                sql_text(
                    "SELECT style_description FROM platform_styles WHERE workspace_id = :wid AND platform = 'general'"
                ),
                {"wid": str(workspace.id)},
            ).fetchone()
            if gen_row and gen_row[0]:
                general_voice = gen_row[0]
            row = db.execute(
                sql_text(
                    "SELECT style_description FROM platform_styles WHERE workspace_id = :wid AND platform = :p"
                ),
                {"wid": str(workspace.id), "p": platform},
            ).fetchone()
            if row and row[0]:
                style_desc = row[0]
        except Exception:
            pass

        # Style learning from posts
        style_learning = ""
        style_dir = data_path(settings, "style_learning")
        style_path = style_dir / f"{platform}.md"
        if style_path.exists() and style_path.stat().st_size > 0:
            content = style_path.read_text().strip()
            if len(content) > 3000:
                content = content[:3000] + "\n...(truncated)"
            style_learning = content

        # Recent corrections list for detail
        recent = list_corrections(db, workspace.id, limit=10, platform=platform)

        # Build the context block
        parts = []
        parts.append(f"## Training Data for {platform.upper()}")
        if general_voice:
            parts.append(f"**General Voice:** {general_voice}")
        if style_desc:
            parts.append(f"**{platform.upper()} Style:** {style_desc}")
        if corrections_md:
            parts.append(corrections_md)
        if style_learning:
            parts.append(f"**Writing Patterns (from real posts):**\n{style_learning}")
        if not general_voice and not style_desc and not corrections_md and not style_learning:
            parts.append(
                "No training data for this platform yet. Use your best judgment based on general brand voice."
            )

        context_block = "\n\n".join(parts)

        logger.info(
            "[tool_result] recall_training → %s: %d corrections, style=%s, learning=%s",
            platform,
            len(recent),
            bool(style_desc),
            bool(style_learning),
        )

        return {
            "type": "recall_training",
            "status": "completed",
            "platform": platform,
            "corrections_count": len(recent),
            "has_style_guide": bool(style_desc),
            "has_imported_style_context": bool(style_learning),
            "context": context_block,
            "message": f"Recalled {len(recent)} corrections and style data for {platform}.",
        }

    logger.warning("[tool_error] unknown tool: %s", tool_name)
    return {"type": "unknown", "status": "error", "message": f"Unknown tool: {tool_name}"}


# Short confirmations the model would say after a tool call
TOOL_CONFIRMATIONS = {
    "generate_drafts": "On it. Drafts are being generated — check back in a minute.",
    "web_search": "Searching...",
    "update_brand": "Brand profile updated.",
    "run_heartbeat": "Running full cycle — scout, analyst, creator. This takes a minute...",
    "setup_platform": "Setting up your profile...",
    "save_onboarding": "Saving your brand profile...",
    "recall_training": "Recalling your voice training...",
}


@router.post("/chat")
async def chat(
    payload: ChatRequest, db: Session = Depends(get_db), _role: str = Depends(require_owner)
):
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)

    # Build unified context for all modes
    from rebel_forge_backend.services.context_builder import build_context, get_mode_description

    if payload.mode == "onboarding":
        # Onboarding uses its own strict prompt — no full context injection
        system_prompt = load_prompt("onboarding")
    else:
        base_prompt = load_prompt(payload.mode)
        unified_context = build_context(
            db=db,
            settings=settings,
            mode=payload.mode,
            mode_description=get_mode_description(payload.mode),
        )
        system_prompt = f"{base_prompt}\n\n{unified_context}"

    conversation = []
    for msg in payload.messages:
        if msg.role in ("user", "assistant"):
            conversation.append({"role": msg.role, "content": msg.content})

    use_tools = True  # Always enable tools — onboarding uses save_onboarding, general uses all

    logger.info(
        "[chat] mode=%s tools=%s messages=%d prompt_len=%d",
        payload.mode,
        use_tools,
        len(conversation),
        len(system_prompt),
    )
    logger.info("[chat] system_prompt: %s", system_prompt[:200])
    if conversation:
        logger.info(
            "[chat] last_message: role=%s content=%s",
            conversation[-1]["role"],
            conversation[-1]["content"][:100],
        )

    # Resolve active LLM provider (DB override → .env fallback)
    from rebel_forge_backend.services.llm_config import get_active_llm

    llm = get_active_llm(db, settings)

    # Codex CLI path — completely separate flow
    # Codex exec is ephemeral (no multi-turn memory). We must inject the full
    # conversation history into the prompt every time, same as the system prompt
    # + conversation array that vLLM gets via the Responses API input field.
    if llm.provider == "codex":
        from rebel_forge_backend.services.codex_middleware import stream_codex_response

        # Format full conversation history as text for Codex (ephemeral, no multi-turn)
        conv_lines = []
        for msg in conversation:
            role = "User" if msg["role"] == "user" else "Agent"
            conv_lines.append(f"{role}: {msg['content']}")
        full_conversation = "\n\n".join(conv_lines) if conv_lines else ""
        last_user_msg = (
            conversation[-1]["content"]
            if conversation and conversation[-1]["role"] == "user"
            else ""
        )

        async def codex_stream():
            async for event in stream_codex_response(
                user_message=full_conversation,
                last_user_message=last_user_msg,
                system_prompt=system_prompt,
                mode=payload.mode,
                settings=settings,
                db=db,
                workspace=workspace,
                codex_model=llm.model if llm.model != "codex" else None,
            ):
                yield event

        return StreamingResponse(codex_stream(), media_type="text/event-stream")

    async def stream():
        timeout = httpx.Timeout(300.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            headers = {"Content-Type": "application/json"}
            if llm.api_key:
                headers["Authorization"] = f"Bearer {llm.api_key}"

            # System prompt as proper system role in input — model follows this strictly
            input_with_system = [{"role": "system", "content": system_prompt}] + conversation

            request_body = {
                "model": llm.model,
                "input": input_with_system,
            }

            active_tools = (
                [tool for tool in CHAT_TOOLS if tool["name"] == "save_onboarding"]
                if payload.mode == "onboarding"
                else CHAT_TOOLS
            )
            request_body["tools"] = active_tools
            request_body["tool_choice"] = "auto"

            try:
                logger.info(
                    "[llm] calling %s/responses (provider=%s model=%s)...",
                    llm.base_url,
                    llm.provider,
                    llm.model,
                )
                response = await client.post(
                    f"{llm.base_url}/responses",
                    json=request_body,
                    headers=headers,
                )
                data = response.json()

                if response.status_code != 200:
                    error_detail = data.get("detail", data.get("error", str(data)))
                    logger.error("[llm_error] %s", error_detail)
                    yield f"data: {json.dumps({'content': f'API error: {error_detail}'})}\n\n"
                    yield "data: [DONE]\n\n"
                    return

                # Log token usage
                usage = data.get("usage", {})
                logger.info(
                    "[llm] tokens: in=%s out=%s (reasoning=%s)",
                    usage.get("input_tokens"),
                    usage.get("output_tokens"),
                    usage.get("output_tokens_details", {}).get("reasoning_tokens"),
                )

                # --- Agentic tool loop ---
                # After ANY tool call, feed the result back to the LLM so it can
                # decide what to do next. The model stops by producing text without
                # more tool calls. Max rounds is a safety limit.
                current_data = data
                current_input = input_with_system
                _last_tool_result = None
                _all_tool_results = []
                max_tool_rounds = 8  # safety limit
                all_tool_names = []
                response_texts: list[str] = []

                for _round in range(max_tool_rounds):
                    has_tool_call = False
                    has_text = False
                    tool_outputs = []  # (call_id, output) pairs to feed back

                    for item in current_data.get("output", []):
                        item_type = item.get("type")

                        if item_type == "message":
                            for content_part in item.get("content", []):
                                if content_part.get("type") == "output_text":
                                    text = content_part.get("text", "")
                                    if text:
                                        has_text = True
                                        response_texts.append(text)
                                        logger.info("[chat] text response: %s", text[:100])
                                        yield f"data: {json.dumps({'content': text})}\n\n"

                        elif item_type == "function_call":
                            has_tool_call = True
                            tool_name = item.get("name", "")
                            call_id = item.get("call_id", item.get("id", ""))
                            arguments_raw = item.get("arguments", "{}")
                            try:
                                arguments = (
                                    json.loads(arguments_raw)
                                    if isinstance(arguments_raw, str)
                                    else arguments_raw
                                )
                            except json.JSONDecodeError:
                                arguments = {}

                            tool_summary = (
                                arguments.pop("summary", "") if isinstance(arguments, dict) else ""
                            )

                            result = _execute_tool(tool_name, arguments, settings, db, workspace)
                            if tool_summary:
                                result["summary"] = tool_summary
                            _last_tool_result = result
                            _all_tool_results.append(result)
                            all_tool_names.append(tool_name)
                            yield f"data: {json.dumps({'tool_result': result})}\n\n"

                            # Build concise output for the LLM based on tool type
                            if tool_name == "recall_training":
                                output = result.get("context") or result.get("message", "")
                            elif tool_name == "web_search" and result.get("results"):
                                lines = [
                                    f"- {sr.get('title', '')}: {sr.get('description', '')}"
                                    for sr in result["results"][:5]
                                ]
                                output = "Search results:\n" + "\n".join(lines)
                            elif tool_name == "query_drafts" and result.get("results"):
                                output = json.dumps(result["results"][:10])
                            else:
                                output = result.get("message") or json.dumps(result)
                            tool_outputs.append((call_id, output))

                    # If any tools were called, feed all results back to LLM
                    if tool_outputs:
                        if _round == max_tool_rounds - 1:
                            terminal_text = (
                                "Tool execution limit reached. Review the completed actions, then "
                                "send another message if more work is needed."
                            )
                            response_texts.append(terminal_text)
                            has_text = True
                            yield f"data: {json.dumps({'content': terminal_text})}\n\n"
                            break
                        logger.info(
                            "[chat] agentic loop round %d: %d tool outputs to feed back",
                            _round + 1,
                            len(tool_outputs),
                        )
                        followup_input = current_input + current_data.get("output", [])
                        for call_id, output in tool_outputs:
                            followup_input.append(
                                {
                                    "type": "function_call_output",
                                    "call_id": call_id,
                                    "output": output,
                                }
                            )

                        followup_body = {
                            "model": llm.model,
                            "input": followup_input,
                            "tools": active_tools,
                            "tool_choice": "auto",
                        }

                        logger.info("[llm] follow-up call (round %d)...", _round + 1)
                        followup_response = await client.post(
                            f"{llm.base_url}/responses",
                            json=followup_body,
                            headers=headers,
                        )
                        current_data = followup_response.json()
                        current_input = followup_input

                        if followup_response.status_code != 200:
                            error_detail = current_data.get(
                                "detail", current_data.get("error", str(current_data))
                            )
                            logger.error("[llm_error] follow-up: %s", error_detail)
                            yield f"data: {json.dumps({'content': f'Follow-up error: {error_detail}'})}\n\n"
                            break
                        continue
                    else:
                        break

                # If tool was called but no text, use the model's summary as the text
                if has_tool_call and not has_text:
                    last_summary = ""
                    for item in current_data.get("output", []):
                        if item.get("type") == "function_call":
                            try:
                                args = (
                                    json.loads(item.get("arguments", "{}"))
                                    if isinstance(item.get("arguments"), str)
                                    else item.get("arguments", {})
                                )
                                last_summary = args.get("summary", "")
                            except (json.JSONDecodeError, AttributeError, TypeError):
                                pass
                    if last_summary:
                        response_texts.append(last_summary)
                        yield f"data: {json.dumps({'content': last_summary})}\n\n"
                    else:
                        confirmation = "Done."
                        for item in current_data.get("output", []):
                            if item.get("type") == "function_call":
                                tool_name = item.get("name", "")
                                confirmation = TOOL_CONFIRMATIONS.get(tool_name, "Done.")
                                break
                        response_texts.append(confirmation)
                        yield f"data: {json.dumps({'content': confirmation})}\n\n"

                # Save conversation to database
                try:
                    from sqlalchemy import text as sql_text

                    # Save user message
                    if conversation:
                        last_user = conversation[-1]
                        if last_user.get("role") == "user":
                            db.execute(
                                sql_text(
                                    "INSERT INTO conversations (workspace_id, mode, role, content, created_at) VALUES (:wid, :mode, 'user', :content, clock_timestamp())"
                                ),
                                {
                                    "wid": str(workspace.id),
                                    "mode": payload.mode,
                                    "content": last_user["content"],
                                },
                            )

                    # Save assistant response
                    full_response = "\n".join(response_texts)
                    tool_names = list(all_tool_names)
                    tool_summaries = []
                    for item in current_data.get("output", []):
                        if item.get("type") == "function_call":
                            final_tool_name = item.get("name", "")
                            if final_tool_name and final_tool_name not in tool_names:
                                tool_names.append(final_tool_name)
                            try:
                                args = (
                                    json.loads(item.get("arguments", "{}"))
                                    if isinstance(item.get("arguments"), str)
                                    else item.get("arguments", {})
                                )
                                if args.get("summary"):
                                    tool_summaries.append(args["summary"])
                            except (json.JSONDecodeError, AttributeError, TypeError):
                                pass

                    usage = current_data.get("usage", {})
                    db.execute(
                        sql_text(
                            "INSERT INTO conversations (workspace_id, mode, role, content, tool_name, tool_result, response_meta, created_at) VALUES (:wid, :mode, 'assistant', :content, :tool, :tool_result, :meta, clock_timestamp())"
                        ),
                        {
                            "wid": str(workspace.id),
                            "mode": payload.mode,
                            "content": full_response
                            or " | ".join(tool_summaries)
                            or ", ".join(tool_names)
                            or "(empty)",
                            "tool": ", ".join(tool_names) if tool_names else None,
                            "tool_result": json.dumps(
                                _all_tool_results
                                if len(_all_tool_results) > 1
                                else _last_tool_result
                            )
                            if _last_tool_result
                            else None,
                            "meta": json.dumps(
                                {
                                    "usage": usage,
                                    "model": llm.model,
                                    "provider": llm.provider,
                                    "tool_names": tool_names,
                                    "tool_summaries": tool_summaries,
                                }
                            ),
                        },
                    )
                    db.commit()
                except Exception as save_err:
                    logger.warning("[chat] Failed to save conversation: %s", save_err)

                yield "data: [DONE]\n\n"

            except httpx.TimeoutException:
                logger.error("[llm_error] timeout")
                yield f"data: {json.dumps({'content': 'Request timed out. Try a simpler request.'})}\n\n"
                yield "data: [DONE]\n\n"
            except Exception as e:
                logger.error("[llm_error] %s", e)
                yield f"data: {json.dumps({'content': f'Error: {str(e)}'})}\n\n"
                yield "data: [DONE]\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


class ConversationToolResultUpdate(BaseModel):
    job_id: UUID
    tool_result: dict


def _merge_job_tool_result(existing, job_id: str, replacement: dict):
    if isinstance(existing, dict):
        if str(existing.get("job_id", "")) == job_id:
            return existing | replacement, True
        return existing, False
    if isinstance(existing, list):
        updated = []
        matched = False
        for item in existing:
            merged, item_matched = _merge_job_tool_result(item, job_id, replacement)
            updated.append(merged)
            matched = matched or item_matched
        return updated, matched
    return existing, False


@router.patch("/conversations/tool-result")
def update_conversation_tool_result(
    payload: ConversationToolResultUpdate,
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    """Update tool_result for a conversation entry by job_id match."""
    from sqlalchemy import text as sql_text

    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)

    rows = db.execute(
        sql_text(
            "SELECT id, tool_result FROM conversations "
            "WHERE workspace_id = :wid AND tool_result IS NOT NULL "
            "ORDER BY created_at DESC"
        ),
        {"wid": str(workspace.id)},
    ).fetchall()
    job_id = str(payload.job_id)
    for conversation_id, raw_result in rows:
        try:
            existing = json.loads(raw_result) if isinstance(raw_result, str) else raw_result
        except (json.JSONDecodeError, TypeError):
            continue
        merged, matched = _merge_job_tool_result(existing, job_id, payload.tool_result)
        if not matched:
            continue
        db.execute(
            sql_text("UPDATE conversations SET tool_result = :result WHERE id = :id"),
            {"result": json.dumps(merged), "id": conversation_id},
        )
        db.commit()
        return {"status": "updated"}

    raise HTTPException(status_code=404, detail="Conversation job result not found")


@router.get("/conversations")
def get_conversations(
    mode: Literal["general", "onboarding"] | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _role: str = Depends(require_owner),
):
    """Get conversation history from database."""
    from sqlalchemy import text as sql_text

    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)

    query = "SELECT id, mode, role, content, tool_name, response_meta, created_at, tool_result FROM conversations WHERE workspace_id = :wid"
    params = {"wid": str(workspace.id)}

    if mode:
        query += " AND mode = :mode"
        params["mode"] = mode

    query += " ORDER BY created_at DESC LIMIT :limit"
    params["limit"] = limit

    rows = db.execute(sql_text(query), params).fetchall()

    return [
        {
            "id": str(r[0]),
            "mode": r[1],
            "role": r[2],
            "content": r[3],
            "tool_name": r[4],
            "response_meta": r[5],
            "created_at": r[6].isoformat() if r[6] else None,
            "tool_result": r[7] if r[7] else None,
        }
        for r in reversed(rows)  # chronological order
    ]
