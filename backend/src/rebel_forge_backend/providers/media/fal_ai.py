"""
fal.ai image generation provider — cloud alternative to ComfyUI.

Uses the fal.ai REST API directly (no SDK dependency).
Supports: FLUX schnell/dev/pro, Nano Banana 2, and any fal.ai model.
"""
import logging
from dataclasses import dataclass

import httpx

from rebel_forge_backend.core.config import Settings

logger = logging.getLogger("rebel_forge_backend.fal_ai")

# Models that use aspect_ratio instead of image_size
ASPECT_RATIO_MODELS = {"fal-ai/nano-banana-2", "fal-ai/flux-pro/v1.1", "fal-ai/flux-2-pro"}


@dataclass
class FalImageResult:
    image_url: str
    width: int
    height: int
    local_path: str = ""


class FalAIProvider:
    def __init__(self, settings: Settings) -> None:
        self.api_key = settings.fal_key
        self.model = settings.fal_model or "fal-ai/flux/schnell"

    def generate_image(self, *, prompt: str, size: str = "1024x1024") -> FalImageResult:
        """Generate an image via fal.ai synchronous endpoint."""
        if not self.api_key:
            raise RuntimeError("FAL_KEY not configured")

        url = f"https://fal.run/{self.model}"
        headers = {
            "Authorization": f"Key {self.api_key}",
            "Content-Type": "application/json",
        }

        # Build payload based on model type
        payload: dict = {
            "prompt": prompt,
            "num_images": 1,
            "output_format": "png",
        }

        if self.model in ASPECT_RATIO_MODELS:
            # Nano Banana 2, FLUX Pro, FLUX 2 Pro — use aspect_ratio
            payload["aspect_ratio"] = self._parse_aspect_ratio(size)
            if "nano-banana" in self.model:
                payload["resolution"] = "1K"
        else:
            # FLUX schnell/dev — use image_size
            payload["image_size"] = self._parse_size(size)
            if "schnell" in self.model:
                payload["num_inference_steps"] = 4
            elif "dev" in self.model:
                payload["num_inference_steps"] = 28
                payload["guidance_scale"] = 3.5

        logger.info("[fal.ai] generating image: model=%s prompt=%s", self.model, prompt[:80])

        try:
            with httpx.Client(timeout=120.0) as client:
                r = client.post(url, headers=headers, json=payload)
                r.raise_for_status()
                data = r.json()
        except httpx.HTTPStatusError as e:
            body = e.response.text[:200] if e.response else ""
            raise RuntimeError(f"fal.ai HTTP {e.response.status_code}: {body}") from e
        except httpx.HTTPError as e:
            raise RuntimeError(f"fal.ai request failed: {e}") from e

        images = data.get("images", [])
        if not images:
            raise RuntimeError(f"fal.ai returned no images: {data}")

        img = images[0]
        image_url = img.get("url", "")
        w = img.get("width") or 1024
        h = img.get("height") or 1024

        logger.info("[fal.ai] image generated: %s (%dx%d)", image_url, w, h)

        return FalImageResult(image_url=image_url, width=w, height=h)

    @staticmethod
    def _parse_size(size: str) -> str:
        """Convert '1024x1024' to fal.ai image_size enum (FLUX models)."""
        size_map = {
            "1024x1024": "square_hd",
            "512x512": "square",
            "1024x768": "landscape_4_3",
            "1280x720": "landscape_16_9",
            "768x1024": "portrait_4_3",
            "720x1280": "portrait_16_9",
        }
        return size_map.get(size, "square_hd")

    @staticmethod
    def _parse_aspect_ratio(size: str) -> str:
        """Convert '1024x1024' to aspect_ratio enum (Nano Banana 2, Pro models)."""
        ratio_map = {
            "1024x1024": "1:1",
            "512x512": "1:1",
            "1024x768": "4:3",
            "1280x720": "16:9",
            "768x1024": "3:4",
            "720x1280": "9:16",
        }
        return ratio_map.get(size, "1:1")
