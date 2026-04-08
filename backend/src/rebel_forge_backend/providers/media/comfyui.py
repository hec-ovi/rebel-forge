"""
ComfyUI provider — generates images via ComfyUI API.
Uses WebSocket for real-time completion notification instead of polling.
"""
import json
import logging
import random
import uuid
from dataclasses import dataclass
from pathlib import Path

import httpx

logger = logging.getLogger("rebel_forge_backend.comfyui")

WORKFLOW_PATH = Path(__file__).resolve().parents[4] / "prompts" / "comfyui_workflow.json"


@dataclass
class ImageResult:
    success: bool
    image_url: str | None = None
    local_path: str | None = None
    error: str | None = None


def _load_workflow(prompt: str, width: int = 1024, height: int = 1024) -> dict:
    """Load the verified workflow template and inject the prompt and dimensions."""
    with open(WORKFLOW_PATH) as f:
        workflow = json.load(f)

    workflow["76"]["inputs"]["value"] = prompt
    workflow["75:68"]["inputs"]["value"] = width
    workflow["75:69"]["inputs"]["value"] = height
    workflow["75:73"]["inputs"]["noise_seed"] = random.randint(0, 2**53)
    workflow["9"]["inputs"]["filename_prefix"] = "rebel_forge"

    return workflow


class ComfyUIProvider:
    """Generate images via ComfyUI API with WebSocket completion tracking."""

    def __init__(self, base_url: str = "http://127.0.0.1:8188") -> None:
        self.base_url = base_url.rstrip("/")
        self.ws_url = self.base_url.replace("http://", "ws://").replace("https://", "wss://")

    def generate_image(self, prompt: str, width: int = 1024, height: int = 1024) -> ImageResult:
        """Generate an image. Uses WebSocket to wait for completion."""
        workflow = _load_workflow(prompt, width, height)
        client_id = str(uuid.uuid4())

        try:
            # Queue the prompt
            with httpx.Client(timeout=30.0) as client:
                r = client.post(
                    f"{self.base_url}/prompt",
                    json={"prompt": workflow, "client_id": client_id},
                )
                if r.status_code != 200:
                    return ImageResult(success=False, error=f"ComfyUI queue failed: {r.text[:300]}")

                prompt_id = r.json().get("prompt_id")
                if not prompt_id:
                    return ImageResult(success=False, error="No prompt_id returned")

            logger.info("[comfyui] Queued prompt %s, waiting via WebSocket...", prompt_id)

            # Wait for completion via WebSocket
            import websocket
            ws = websocket.WebSocket()
            ws.settimeout(600)  # 10 min max
            ws.connect(f"{self.ws_url}/ws?clientId={client_id}")

            try:
                while True:
                    msg = ws.recv()
                    if isinstance(msg, str):
                        data = json.loads(msg)
                        msg_type = data.get("type")

                        if msg_type == "executing":
                            exec_data = data.get("data", {})
                            if exec_data.get("prompt_id") == prompt_id and exec_data.get("node") is None:
                                # Execution complete
                                logger.info("[comfyui] Execution complete for %s", prompt_id)
                                break

                        if msg_type == "execution_error":
                            err = data.get("data", {})
                            return ImageResult(success=False, error=f"ComfyUI error: {str(err)[:200]}")
            finally:
                ws.close()

            # Fetch the result from history
            with httpx.Client(timeout=30.0) as client:
                r = client.get(f"{self.base_url}/history/{prompt_id}")
                if r.status_code != 200:
                    return ImageResult(success=False, error="Failed to fetch history")

                history = r.json()
                if prompt_id not in history:
                    return ImageResult(success=False, error="Prompt not found in history")

                outputs = history[prompt_id].get("outputs", {})
                for node_id, node_output in outputs.items():
                    images = node_output.get("images", [])
                    if images:
                        img = images[0]
                        filename = img.get("filename")
                        subfolder = img.get("subfolder", "")
                        image_url = f"{self.base_url}/view?filename={filename}&subfolder={subfolder}&type=output"
                        logger.info("[comfyui] Image generated: %s", filename)
                        return ImageResult(success=True, image_url=image_url, local_path=filename)

            return ImageResult(success=False, error="No images in output")

        except Exception as e:
            logger.error("[comfyui] Generation failed: %s", e)
            return ImageResult(success=False, error=str(e))
