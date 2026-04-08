"""
Unified context builder — assembles the full context window for any agent mode.

Every mode (chat, training, heartbeat, draft generation) gets the same rich context,
structured consistently. The only thing that changes is the `mode` section.
"""
import json
import logging
from uuid import UUID

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from rebel_forge_backend.core.config import Settings
from rebel_forge_backend.services.corrections import get_corrections_context, list_corrections
from rebel_forge_backend.services.workspace import WorkspaceService

logger = logging.getLogger("rebel_forge_backend.context_builder")


def build_context(
    *,
    db: Session,
    settings: Settings,
    mode: str,
    mode_description: str = "",
    platform: str | None = None,
) -> str:
    """
    Build the full context block injected into every agent prompt.

    Returns a structured markdown string with sections:
    - Role
    - Mode
    - Onboarding Profile
    - Products
    - Training History
    - Conversation History
    - Available Systems
    - Database Schema (for query tool)
    """
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    bp = workspace.brand_profile

    sections = []

    # === ROLE ===
    sections.append("""## Role
You are Rebel, the AI agent behind Rebel Forge — an open-source, local-first social media management system.
You manage content across X, LinkedIn, Instagram, Threads, and Facebook.
You are direct, fast, and production-focused. No filler, no fluff.""")

    # === MODE ===
    if mode_description:
        sections.append(f"## Mode\n{mode_description}")

    # === ONBOARDING PROFILE ===
    if bp:
        onboarding = []
        if bp.voice_summary:
            onboarding.append(f"- Voice/Tone: {bp.voice_summary}")
        if bp.audience_summary:
            onboarding.append(f"- Audience: {bp.audience_summary}")
        if bp.goals:
            goals = bp.goals
            if isinstance(goals, dict):
                if goals.get("primary"):
                    onboarding.append(f"- Primary Goal: {goals['primary']}")
                if goals.get("platforms"):
                    platforms = goals["platforms"]
                    if isinstance(platforms, list):
                        onboarding.append(f"- Platforms: {', '.join(platforms)}")
            else:
                onboarding.append(f"- Goals: {goals}")
        if bp.style_notes:
            sn = bp.style_notes
            if sn.get("content_types"):
                ct = sn["content_types"]
                onboarding.append(f"- Content Types: {', '.join(ct) if isinstance(ct, list) else ct}")
            if sn.get("frequency"):
                onboarding.append(f"- Posting Frequency: {sn['frequency']}")
            if sn.get("inspiration"):
                onboarding.append(f"- Inspiration: {sn['inspiration']}")
            if sn.get("tone"):
                tone = sn["tone"]
                onboarding.append(f"- Tone Tags: {', '.join(tone) if isinstance(tone, list) else tone}")
        if bp.reference_examples:
            refs = bp.reference_examples
            if isinstance(refs, list) and refs:
                onboarding.append(f"- Reference Accounts: {', '.join(str(r) for r in refs)}")

        if onboarding:
            sections.append("## Onboarding Profile\nThe user completed onboarding with these preferences:\n" + "\n".join(onboarding))
        else:
            sections.append("## Onboarding Profile\nNot yet completed.")
    else:
        sections.append("## Onboarding Profile\nNot yet completed.")

    # === PRODUCTS ===
    products = []
    if bp and bp.style_notes:
        products = bp.style_notes.get("products", [])
    if products:
        product_lines = []
        for p in products:
            line = f"- **{p.get('name', 'Unnamed')}**: {p.get('description', 'No description')}"
            if p.get("target_audience"):
                line += f" | Audience: {p['target_audience']}"
            if p.get("key_features"):
                line += f" | Features: {', '.join(p['key_features'])}"
            if p.get("tags"):
                line += f" | Tags: {', '.join(p['tags'])}"
            product_lines.append(line)
        sections.append("## Products / Topics\nThe user has defined these products for content creation:\n" + "\n".join(product_lines))
    else:
        sections.append("## Products / Topics\nNo products defined yet.")

    # === TRAINING HISTORY ===
    # When platform is specified, filter corrections to that platform only
    corrections_md = get_corrections_context(db, workspace.id, platform=platform)
    if corrections_md:
        platform_note = f" for {platform.upper()}" if platform else ""
        sections.append(f"## Training History (HFRL){platform_note}\nThe user has trained you through feedback. Apply these learned patterns to ALL content:\n{corrections_md}")
    else:
        sections.append("## Training History\nNo training data yet. The user has not submitted corrections.")

    # === STYLE GUIDES ===
    try:
        # Always load general voice if it exists
        general_row = db.execute(sql_text(
            "SELECT style_description FROM platform_styles WHERE workspace_id = :wid AND platform = 'general' AND style_description != ''"
        ), {"wid": str(workspace.id)}).fetchone()
        general_voice = general_row[0] if general_row else ""

        if platform:
            # Load platform-specific style
            row = db.execute(sql_text(
                "SELECT style_description FROM platform_styles WHERE workspace_id = :wid AND platform = :p AND style_description != ''"
            ), {"wid": str(workspace.id), "p": platform}).fetchone()
            platform_style = row[0] if row else ""

            style_parts = []
            if general_voice:
                style_parts.append(f"**General Voice:** {general_voice}")
            if platform_style:
                style_parts.append(f"**{platform.upper()} Style:** {platform_style}")
            if style_parts:
                sections.append(f"## Style Guide\nIMPORTANT — follow this style strictly:\n" + "\n".join(style_parts))
        else:
            # No platform filter — show all styles
            style_rows = db.execute(sql_text(
                "SELECT platform, style_description FROM platform_styles WHERE workspace_id = :wid AND style_description != ''"
            ), {"wid": str(workspace.id)}).fetchall()
            if style_rows:
                style_lines = [f"- **{r[0]}**: {r[1]}" for r in style_rows]
                sections.append("## Style Guidelines\nVoice and style set by the user:\n" + "\n".join(style_lines))
    except Exception:
        pass

    # === CONVERSATION HISTORY ===
    try:
        rows = db.execute(sql_text(
            "SELECT role, content, tool_name FROM conversations WHERE workspace_id = :wid AND mode = 'general' ORDER BY created_at DESC LIMIT 20"
        ), {"wid": str(workspace.id)}).fetchall()

        if rows:
            history_lines = []
            for r in reversed(rows):
                role, content, tool = r[0], r[1], r[2]
                if tool:
                    history_lines.append(f"- [{role}] [tool:{tool}] {content[:150]}")
                else:
                    history_lines.append(f"- [{role}] {content[:150]}")
            sections.append("## Recent Conversation History\nLast interactions with the user:\n" + "\n".join(history_lines))
    except Exception as e:
        logger.debug("[context] Failed to load conversation history: %s", e)

    # === PLATFORM PROFILES ===
    if bp and bp.style_notes:
        profiles = bp.style_notes.get("platform_profiles", {})
        if profiles:
            profile_lines = []
            for platform, profile in profiles.items():
                name = profile.get("display_name", "")
                handle = profile.get("handle", "")
                bio = profile.get("bio", "")
                if name or handle:
                    profile_lines.append(f"- {platform}: {name} ({handle}) — {bio[:100]}")
            if profile_lines:
                sections.append("## Platform Profiles\n" + "\n".join(profile_lines))

    # === AVAILABLE SYSTEMS ===
    systems = ["PostgreSQL database", "vLLM / Codex CLI / OpenRouter (configurable LLM)"]
    try:
        import httpx
        r = httpx.get(f"{settings.comfyui_base_url}/", timeout=2.0)
        if r.status_code == 200:
            systems.append(f"ComfyUI image generation at {settings.comfyui_base_url}")
    except Exception:
        pass
    if settings.firecrawl_api_key:
        systems.append("Firecrawl web search")
    if settings.r2_endpoint_url:
        systems.append("Cloudflare R2 image hosting")
    sections.append("## Available Systems\n" + "\n".join(f"- {s}" for s in systems))

    # === DATABASE SCHEMA (for query tool) ===
    sections.append("""## Database Schema (for query_drafts tool)
Table `content_drafts`:
- id (UUID), workspace_id (UUID), platform (text), status (enum: draft/reviewed/approved/scheduled/published/failed)
- concept (text), brief (text), caption (text), hook (text), cta (text)
- hashtags (jsonb array), alt_text (text), media_prompt (text nullable)
- script (text nullable), metadata_json (jsonb), created_at, updated_at

Table `published_posts`:
- id, draft_id (FK), platform, platform_post_id, published_at, url

Example queries:
- SELECT platform, status, concept, caption FROM content_drafts WHERE workspace_id = '{wid}' ORDER BY created_at DESC LIMIT 10
- SELECT COUNT(*) as total, platform FROM content_drafts WHERE workspace_id = '{wid}' GROUP BY platform
- SELECT * FROM content_drafts WHERE workspace_id = '{wid}' AND platform = 'x' AND status = 'published'""".replace("{wid}", str(workspace.id)))

    # === STYLE LEARNING (from platform posts) ===
    from pathlib import Path as _Path
    style_dir = _Path(__file__).resolve().parents[2] / "data" / "style_learning"
    if style_dir.exists():
        style_parts = []
        if platform:
            # Only load the target platform's style learning
            sf = style_dir / f"{platform}.md"
            if sf.exists() and sf.stat().st_size > 0:
                content = sf.read_text().strip()
                if len(content) > 3000:
                    content = content[:3000] + "\n...(truncated)"
                style_parts.append(content)
        else:
            for sf in style_dir.glob("*.md"):
                if sf.stat().st_size > 0:
                    content = sf.read_text().strip()
                    if len(content) > 3000:
                        content = content[:3000] + "\n...(truncated)"
                    style_parts.append(content)
        if style_parts:
            sections.append("## Style Learning (from platform posts)\nThe user's actual writing style learned from their published posts:\n\n" + "\n\n---\n\n".join(style_parts))

    # === RULES ===
    sections.append("""## Rules
- Never include example.com, placeholder URLs, or fake links.
- Never use the long dash.
- Never invent specific numbers, stats, or technical claims.
- Only state facts from the user's brand profile or training data.
- Keep posts compact. Write like a human, not like AI.""")

    return "\n\n".join(sections)


def get_mode_description(mode: str) -> str:
    """Return the mode-specific description block."""
    descriptions = {
        "general": (
            "You are in **Rebel Chat** mode — the main interactive chat.\n"
            "The user talks to you to generate content, search trends, manage drafts, publish posts, "
            "and configure their brand. Use your tools when appropriate. Keep responses under 2 sentences "
            "unless explaining something the user asked about."
        ),
        "onboarding": (
            "You are in **Onboarding** mode.\n"
            "Ask the user 7 questions, ONE AT A TIME, to set up their brand profile. "
            "Never combine questions. After all 7 answers, call the save_onboarding tool."
        ),
        "training": (
            "You are in **Training** mode.\n"
            "Generate sample content for the user to rate and correct. "
            "Use the full training history and product context to improve each generation. "
            "The user's corrections teach you their voice through HFRL (Human Feedback Reinforcement Learning)."
        ),
        "heartbeat": (
            "You are in **Heartbeat** mode — autonomous background operation.\n"
            "Scout for trends, analyze past performance, and generate new content drafts. "
            "Use the full brand context, training history, and product list to create on-brand content."
        ),
        "draft_generation": (
            "You are in **Draft Generation** mode.\n"
            "Generate production-ready social media drafts that match the brand voice, "
            "incorporate training feedback, and align with the user's products and goals."
        ),
    }
    return descriptions.get(mode, f"You are in **{mode}** mode.")
