from dataclasses import dataclass
from typing import Any

import httpx

from rebel_forge_backend.core.config import Settings


@dataclass
class OpenAIImageResult:
    prompt: str
    revised_prompt: str | None
    b64_json: str | None
    external_url: str | None


class OpenAIImagesProvider:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def generate_image(self, *, prompt: str, size: str) -> OpenAIImageResult:
        payload = {
            "model": self.settings.media_model,
            "prompt": prompt,
            "size": size,
            "response_format": self.settings.media_response_format,
        }
        try:
            with self._client() as client:
                response = client.post("/images/generations", json=payload)
                response.raise_for_status()
                data = response.json()
        except httpx.HTTPError as exc:
            raise RuntimeError(
                f"Media provider request failed against {self.settings.media_base_url}: {exc}"
            ) from exc
        return self._parse_result(prompt, data)

    def _client(self) -> httpx.Client:
        headers = {"Content-Type": "application/json"}
        if self.settings.media_api_key:
            headers["Authorization"] = f"Bearer {self.settings.media_api_key}"
        return httpx.Client(
            base_url=self.settings.media_base_url.rstrip("/"), headers=headers, timeout=None
        )

    @staticmethod
    def _parse_result(prompt: str, payload: dict[str, Any]) -> OpenAIImageResult:
        data = payload.get("data", [])
        if not data:
            raise ValueError("Image provider returned no image data.")
        first = data[0]
        return OpenAIImageResult(
            prompt=prompt,
            revised_prompt=first.get("revised_prompt"),
            b64_json=first.get("b64_json"),
            external_url=first.get("url"),
        )
