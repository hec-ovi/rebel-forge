import asyncio

import httpx
from sqlalchemy.orm import Session

from rebel_forge_backend.core.config import Settings
from rebel_forge_backend.services.llm_config import get_active_llm


def _extract_response_text(payload: dict) -> str:
    for item in payload.get("output", []):
        if item.get("type") != "message":
            continue
        for part in item.get("content", []):
            if part.get("type") == "output_text" and isinstance(part.get("text"), str):
                return part["text"]
    raise ValueError("LLM response did not contain output text")


def generate_text(
    db: Session,
    settings: Settings,
    *,
    instructions: str,
    prompt: str,
) -> str:
    """Generate text through the selected Responses-compatible or Codex provider."""
    llm = get_active_llm(db, settings)
    if llm.provider == "codex":
        from rebel_forge_backend.services.codex_agent import run_codex

        result = asyncio.run(
            run_codex(
                prompt=prompt,
                system_prompt=instructions,
                model=llm.model if llm.model != "codex" else None,
                tool_prompt="",
            )
        )
        if result.error:
            raise RuntimeError(result.error)
        if not result.text:
            raise ValueError("Codex returned no output text")
        return result.text

    headers = {"Content-Type": "application/json"}
    if llm.api_key:
        headers["Authorization"] = f"Bearer {llm.api_key}"
    timeout = httpx.Timeout(300.0, connect=10.0)
    with httpx.Client(timeout=timeout) as client:
        response = client.post(
            f"{llm.base_url.rstrip('/')}/responses",
            headers=headers,
            json={
                "model": llm.model,
                "instructions": instructions,
                "input": [{"role": "user", "content": prompt}],
            },
        )
        response.raise_for_status()
        payload = response.json()
    return _extract_response_text(payload)
