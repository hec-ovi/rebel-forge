"""
Codex CLI draft provider — generates drafts by spawning codex exec.

Same interface as OpenAIResponsesProvider but uses subprocess instead of HTTP.
The model is prompted to return JSON directly (no tool calling needed).
"""
import asyncio
import json
import logging
import shutil
import subprocess

from rebel_forge_backend.core.config import Settings
from rebel_forge_backend.schemas.drafts import DraftPackageSubmission

logger = logging.getLogger("rebel_forge_backend.codex_cli_provider")

CODEX_BIN = shutil.which("codex") or "codex"


class CodexCLIProvider:
    def __init__(self, settings: Settings, *, model: str = "") -> None:
        self.settings = settings
        self._model = model or ""

    def generate_draft_package(self, *, prompt: str, count: int) -> DraftPackageSubmission:
        """Generate drafts via codex exec. Synchronous (worker runs in its own thread)."""

        full_prompt = f"""{prompt}

IMPORTANT: Return your response as a JSON object with exactly this structure:
{{"drafts": [{{"platform": "...", "concept": "...", "caption": "...", "hook": "...", "cta": "...", "hashtags": ["..."], "alt_text": "...", "media_prompt": null, "script": null}}]}}

Return exactly {count} draft objects. Return ONLY the JSON, no explanation, no markdown code blocks."""

        args = [
            CODEX_BIN, "exec",
            "--json",
            "--color", "never",
            "--sandbox", "read-only",
            "--skip-git-repo-check",
            "--ephemeral",
        ]

        if self._model and self._model != "codex":
            args.extend(["-m", self._model])

        # Use stdin for the prompt
        args.append("-")

        logger.info("[codex_cli] generating %d drafts (prompt=%d chars)", count, len(full_prompt))

        try:
            proc = subprocess.run(
                args,
                input=full_prompt,
                capture_output=True,
                text=True,
                timeout=180,
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError("Codex CLI timed out after 180s")
        except FileNotFoundError:
            raise RuntimeError(f"Codex CLI binary not found at {CODEX_BIN}")

        # Parse JSONL output
        text = ""
        for line in proc.stdout.strip().split("\n"):
            if not line.strip():
                continue
            try:
                event = json.loads(line)
                if event.get("type") == "item.completed":
                    item = event.get("item", {})
                    if item.get("type") == "agent_message":
                        text = item.get("text", "")
                elif event.get("type") == "turn.failed":
                    err = event.get("error", {})
                    raise RuntimeError(f"Codex turn failed: {err.get('message', str(err))}")
            except json.JSONDecodeError:
                continue

        if not text:
            raise RuntimeError("Codex CLI returned no text response")

        # Parse the JSON from the response
        text = text.strip()

        # Strip markdown code blocks if present
        if text.startswith("```"):
            lines = text.split("\n")
            lines = [l for l in lines if not l.strip().startswith("```")]
            text = "\n".join(lines).strip()

        # Find the JSON object
        start = text.find("{")
        end = text.rfind("}") + 1
        if start < 0 or end <= start:
            raise RuntimeError(f"Codex CLI response doesn't contain JSON: {text[:200]}")

        try:
            data = json.loads(text[start:end])
        except json.JSONDecodeError as e:
            raise RuntimeError(f"Failed to parse Codex JSON: {e}\nRaw: {text[:300]}")

        return DraftPackageSubmission.model_validate(data)
