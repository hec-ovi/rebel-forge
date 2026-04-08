"""
Codex CLI agent — spawns `codex exec` as a subprocess.

Tool calling: the model is prompted to return JSON when it wants a tool.
We parse the response, execute the tool, then resume the session with the result.
"""
import asyncio
import json
import logging
import shutil
from dataclasses import dataclass, field

logger = logging.getLogger("rebel_forge_backend.codex_agent")

CODEX_BIN = shutil.which("codex") or "codex"

# Tool definitions injected into the system prompt
TOOL_PROMPT = """
You have these tools. When you need one, respond ONLY with a JSON object on a single line:
{"tool": "tool_name", "args": {"param": "value"}, "summary": "one sentence of what you are doing"}

Available tools:
- generate_drafts(platform, count, brief, objective, auto_approve, auto_publish, generate_image): Generate social media drafts. ALWAYS default to draft-only. NEVER set auto_approve or auto_publish unless the user EXPLICITLY says "approve", "publish", "post it", or "send it live". Set generate_image=true only if user asks for an image.
- web_search(query): Search the web for trends, news, or current info.
- approve_draft(draft_id): Approve a pending draft. Omit draft_id to approve the latest.
- publish_draft(draft_id, platform): Publish a draft. Auto-approves if needed. Omit draft_id for the latest.
- run_heartbeat(): Run a full scout-analyst-creator cycle.
- update_brand(voice_summary, audience_summary, goals): Update the brand profile.
- save_onboarding(platforms, voice, goals, content_types, frequency, audience, inspiration): Save the onboarding profile after asking all questions.
- setup_platform(platform, niche): Generate a complete platform profile.
- generate_image(draft_id, prompt): Generate an image for a draft. Omit draft_id for the latest. Omit prompt to auto-generate from draft content.
- query_drafts(sql): Query the drafts database. SELECT-only. Example: SELECT platform, status, concept FROM content_drafts ORDER BY created_at DESC LIMIT 5

When you do NOT need a tool, respond with plain text. Keep responses under 2 sentences.
Do not wrap tool JSON in markdown code blocks. Just the raw JSON object.
"""


@dataclass
class CodexResponse:
    """Parsed response from a codex exec call."""
    text: str = ""
    tool_call: dict | None = None  # {"tool": "...", "args": {...}, "summary": "..."}
    thread_id: str = ""
    usage: dict = field(default_factory=dict)
    error: str = ""


async def run_codex(
    prompt: str,
    system_prompt: str = "",
    session_id: str | None = None,
    model: str | None = None,
) -> CodexResponse:
    """
    Spawn codex exec and return the parsed response.

    If session_id is provided, resumes that session.
    """
    full_prompt = f"{system_prompt}\n\n{TOOL_PROMPT}\n\nThe user says: {prompt}" if not session_id else prompt

    args = [
        CODEX_BIN, "exec",
        "--json",
        "--color", "never",
        "--sandbox", "read-only",
        "--skip-git-repo-check",
        "--ephemeral",
    ]

    if model:
        args.extend(["-m", model])

    if session_id:
        args.extend(["resume", session_id])
        # For resume, pass prompt as arg (short)
        args.append(full_prompt)
        stdin_data = None
    else:
        # Use stdin for long prompts (avoids shell arg length limits)
        args.append("-")
        stdin_data = full_prompt.encode("utf-8")

    logger.info("[codex] spawning: %s (prompt=%d chars)", " ".join(args[:8]) + "...", len(full_prompt))

    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.PIPE if stdin_data else None,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stdout, stderr = await asyncio.wait_for(proc.communicate(input=stdin_data), timeout=120)
    except asyncio.TimeoutError:
        logger.error("[codex] timeout after 120s")
        return CodexResponse(error="Codex CLI timed out")
    except FileNotFoundError:
        logger.error("[codex] binary not found at %s", CODEX_BIN)
        return CodexResponse(error="Codex CLI not installed")

    if stderr:
        logger.debug("[codex] stderr: %s", stderr.decode()[:200])

    result = CodexResponse()

    for line in stdout.decode().strip().split("\n"):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue

        etype = event.get("type", "")

        if etype == "thread.started":
            result.thread_id = event.get("thread_id", "")

        elif etype == "item.completed":
            item = event.get("item", {})
            if item.get("type") == "agent_message":
                result.text = item.get("text", "")
            elif item.get("type") == "error":
                result.error = item.get("message", "")

        elif etype == "turn.completed":
            result.usage = event.get("usage", {})

        elif etype == "turn.failed":
            err = event.get("error", {})
            result.error = err.get("message", str(err))

        elif etype == "error":
            result.error = event.get("message", "Unknown error")

    # Try to parse tool call from text
    if result.text:
        result.tool_call = _parse_tool_call(result.text)
        if result.tool_call:
            # Text was a tool call, not a chat message
            logger.info("[codex] tool call detected: %s", result.tool_call.get("tool"))

    return result


def _parse_tool_call(text: str) -> dict | None:
    """Try to extract a tool call JSON from the model's response."""
    text = text.strip()

    # Strip markdown code blocks if present
    if text.startswith("```"):
        lines = text.split("\n")
        # Remove first and last lines (``` markers)
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines).strip()

    # Try direct JSON parse
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict) and "tool" in parsed:
            return parsed
    except json.JSONDecodeError:
        pass

    # Try to find JSON object in the text
    start = text.find('{"tool"')
    if start == -1:
        start = text.find("{'tool")  # single quotes variant
    if start >= 0:
        # Find matching closing brace
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except json.JSONDecodeError:
                        break

    return None
