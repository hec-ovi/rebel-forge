import json
from typing import Any

import httpx

from rebel_forge_backend.core.config import Settings
from rebel_forge_backend.schemas.drafts import DraftPackageSubmission


class OpenAIResponsesProvider:
    def __init__(self, settings: Settings, *, base_url: str = "", api_key: str = "", model: str = "") -> None:
        self.settings = settings
        # Allow runtime overrides (from DB provider config)
        self._base_url = base_url or settings.llm_base_url
        self._api_key = api_key or settings.llm_api_key
        self._model = model or settings.llm_model

    def generate_draft_package(self, *, prompt: str, count: int) -> DraftPackageSubmission:
        payload = {
            "model": self._model,
            "input": prompt,
            "tool_choice": "auto",
            "max_output_tokens": self.settings.llm_max_output_tokens,
            "tools": [
                {
                    "type": "function",
                    "name": "submit_draft_package",
                    "description": (
                        f"Submit the final draft package. Call this tool exactly once with {count} draft objects."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "drafts": {
                                "type": "array",
                                "minItems": count,
                                "maxItems": count,
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "platform": {"type": "string"},
                                        "concept": {"type": "string"},
                                        "caption": {"type": "string"},
                                        "hook": {"type": "string"},
                                        "cta": {"type": "string"},
                                        "hashtags": {
                                            "type": "array",
                                            "items": {"type": "string"},
                                        },
                                        "alt_text": {"type": "string"},
                                        "media_prompt": {"type": ["string", "null"], "description": "Image generation prompt. Required for Instagram. For other platforms, only include if the user explicitly asked for an image. Set to null for text-only posts."},
                                        "script": {"type": ["string", "null"]},
                                    },
                                    "required": [
                                        "platform",
                                        "concept",
                                        "caption",
                                        "hook",
                                        "cta",
                                        "hashtags",
                                        "alt_text",
                                    ],
                                    "additionalProperties": False,
                                },
                            }
                        },
                        "required": ["drafts"],
                        "additionalProperties": False,
                    },
                }
            ],
        }

        try:
            with self._client() as client:
                response = client.post("/responses", json=payload)
                response.raise_for_status()
                data = response.json()
        except httpx.HTTPError as exc:
            raise RuntimeError(
                f"LLM provider request failed against {self.settings.llm_base_url}: {exc}"
            ) from exc
        arguments = self._extract_function_arguments(data, "submit_draft_package")
        return DraftPackageSubmission.model_validate(arguments)

    def _client(self) -> httpx.Client:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return httpx.Client(base_url=self._base_url.rstrip("/"), headers=headers, timeout=None)

    @staticmethod
    def _extract_function_arguments(payload: dict[str, Any], function_name: str) -> dict[str, Any]:
        for item in payload.get("output", []):
            if item.get("type") == "function_call" and item.get("name") == function_name:
                raw_arguments = item.get("arguments", "{}")
                if isinstance(raw_arguments, str):
                    return json.loads(raw_arguments)
                return raw_arguments
        raise ValueError("LLM response did not contain the expected function call.")
