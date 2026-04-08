"""
Connections management — read and update platform API credentials.
Reads from .env file, writes back to .env file.
No database needed — .env is the source of truth for credentials.
"""
import logging
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from rebel_forge_backend.api.auth import require_owner
from rebel_forge_backend.core.config import get_settings

logger = logging.getLogger("rebel_forge_backend.connections")

router = APIRouter()

ENV_PATH = Path(__file__).resolve().parents[4] / ".env"

# Map: platform_id → list of (field_name, env_var_name)
PLATFORM_ENV_MAP = {
    "x": [
        ("consumer_key", "X_CONSUMER_KEY"),
        ("consumer_secret", "X_CONSUMER_SECRET"),
        ("access_token", "X_ACCESS_TOKEN"),
        ("access_token_secret", "X_ACCESS_TOKEN_SECRET"),
    ],
    "linkedin": [
        ("access_token", "LINKEDIN_ACCESS_TOKEN"),
        ("person_id", "LINKEDIN_PERSON_ID"),
    ],
    "facebook": [
        ("access_token", "FACEBOOK_ACCESS_TOKEN"),
        ("page_id", "FACEBOOK_PAGE_ID"),
        ("page_token", "FACEBOOK_PAGE_TOKEN"),
    ],
    "instagram": [
        ("access_token", "INSTAGRAM_ACCESS_TOKEN"),
        ("user_id", "INSTAGRAM_USER_ID"),
    ],
    "threads": [
        ("access_token", "THREADS_ACCESS_TOKEN"),
        ("user_id", "THREADS_USER_ID"),
    ],
    "tiktok": [
        ("access_token", "TIKTOK_ACCESS_TOKEN"),
    ],
    "youtube": [
        ("api_key", "YOUTUBE_API_KEY"),
        ("channel_id", "YOUTUBE_CHANNEL_ID"),
    ],
    "pinterest": [
        ("access_token", "PINTEREST_ACCESS_TOKEN"),
    ],
    "openai": [
        ("api_key", "OPENAI_API_KEY"),
    ],
    "anthropic": [
        ("api_key", "ANTHROPIC_API_KEY"),
    ],
    "gemini": [
        ("api_key", "GEMINI_API_KEY"),
    ],
    "grok": [
        ("api_key", "GROK_API_KEY"),
    ],
    "openrouter": [
        ("api_key", "OPENROUTER_API_KEY"),
    ],
    "vllm": [
        ("base_url", "LLM_BASE_URL"),
        ("model", "LLM_MODEL"),
        ("api_key", "LLM_API_KEY"),
    ],
    "firecrawl": [
        ("api_key", "FIRECRAWL_API_KEY"),
        ("api_url", "FIRECRAWL_API_URL"),
    ],
    "cloudflare_r2": [
        ("endpoint_url", "R2_ENDPOINT_URL"),
        ("access_key_id", "R2_ACCESS_KEY_ID"),
        ("secret_access_key", "R2_SECRET_ACCESS_KEY"),
        ("bucket_name", "R2_BUCKET_NAME"),
        ("public_url", "R2_PUBLIC_URL"),
    ],
    "comfyui": [
        ("base_url", "COMFYUI_BASE_URL"),
    ],
    "fal_ai": [
        ("api_key", "FAL_KEY"),
        ("model", "FAL_MODEL"),
    ],
}


def _read_env() -> dict[str, str]:
    """Read all key=value pairs from .env file."""
    env = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                env[key.strip()] = value.strip()
    return env


def _write_env(env: dict[str, str]) -> None:
    """Write key=value pairs back to .env file, preserving comments and order."""
    if not ENV_PATH.exists():
        return

    lines = ENV_PATH.read_text().splitlines()
    new_lines = []
    written_keys = set()

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            new_lines.append(line)
            continue
        if "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key in env:
                new_lines.append(f"{key}={env[key]}")
                written_keys.add(key)
            else:
                new_lines.append(line)
        else:
            new_lines.append(line)

    # Append any new keys not already in the file
    for key, value in env.items():
        if key not in written_keys:
            new_lines.append(f"{key}={value}")

    ENV_PATH.write_text("\n".join(new_lines) + "\n")


def _mask(value: str) -> str:
    """Mask a credential for display."""
    if not value:
        return ""
    if len(value) <= 8:
        return "****"
    return "****" + value[-4:]


# Fields that are not secrets — show full value
_NON_SECRET_FIELDS = {"base_url", "model", "api_url", "base_url"}


class ConnectionResponse(BaseModel):
    platform: str
    connected: bool
    credentials: dict[str, str]  # masked values
    fields: list[str]


class ConnectionUpdate(BaseModel):
    credentials: dict[str, str]


@router.get("/connections")
def list_connections(_role: str = Depends(require_owner)):
    """List all platforms with connection status."""
    env = _read_env()
    settings = get_settings()
    env_to_attr = {
        "COMFYUI_BASE_URL": "comfyui_base_url",
        "LLM_BASE_URL": "llm_base_url", "LLM_MODEL": "llm_model", "LLM_API_KEY": "llm_api_key",
        "FAL_KEY": "fal_key", "FAL_MODEL": "fal_model",
        "FIRECRAWL_API_KEY": "firecrawl_api_key", "FIRECRAWL_API_URL": "firecrawl_api_url",
    }
    result = []

    for platform_id, field_map in PLATFORM_ENV_MAP.items():
        creds = {}
        has_any = False
        for field_name, env_var in field_map:
            value = env.get(env_var, "")
            if not value and env_var in env_to_attr:
                value = str(getattr(settings, env_to_attr[env_var], ""))
            if value and not value.startswith("your-"):
                has_any = True
                creds[field_name] = value if field_name in _NON_SECRET_FIELDS else _mask(value)
            else:
                creds[field_name] = ""

        result.append({
            "platform": platform_id,
            "connected": has_any,
            "credentials": creds,
            "fields": [f[0] for f in field_map],
        })

    return result


@router.get("/connections/{platform_id}", response_model=ConnectionResponse)
def get_connection(platform_id: str, _role: str = Depends(require_owner)):
    """Get connection details for a specific platform. Values are masked."""
    if platform_id not in PLATFORM_ENV_MAP:
        raise HTTPException(status_code=404, detail=f"Unknown platform: {platform_id}")

    env = _read_env()
    settings = get_settings()
    field_map = PLATFORM_ENV_MAP[platform_id]

    # Map env var names to Settings attribute names for fallback
    env_to_attr = {
        "COMFYUI_BASE_URL": "comfyui_base_url",
        "LLM_BASE_URL": "llm_base_url", "LLM_MODEL": "llm_model", "LLM_API_KEY": "llm_api_key",
        "FAL_KEY": "fal_key", "FAL_MODEL": "fal_model",
        "FIRECRAWL_API_KEY": "firecrawl_api_key", "FIRECRAWL_API_URL": "firecrawl_api_url",
    }

    creds = {}
    has_any = False
    for field_name, env_var in field_map:
        value = env.get(env_var, "")
        # Fall back to Settings default if .env doesn't have it
        if not value and env_var in env_to_attr:
            value = str(getattr(settings, env_to_attr[env_var], ""))
        if value and not value.startswith("your-"):
            has_any = True
            creds[field_name] = value if field_name in _NON_SECRET_FIELDS else _mask(value)
        else:
            creds[field_name] = ""

    return ConnectionResponse(
        platform=platform_id,
        connected=has_any,
        credentials=creds,
        fields=[f[0] for f in field_map],
    )


@router.put("/connections/{platform_id}", response_model=ConnectionResponse)
def update_connection(platform_id: str, payload: ConnectionUpdate, _role: str = Depends(require_owner)):
    """Update credentials for a platform. Writes to .env file."""
    if platform_id not in PLATFORM_ENV_MAP:
        raise HTTPException(status_code=404, detail=f"Unknown platform: {platform_id}")

    env = _read_env()
    field_map = PLATFORM_ENV_MAP[platform_id]

    # Update env values
    for field_name, env_var in field_map:
        if field_name in payload.credentials:
            env[env_var] = payload.credentials[field_name]

    _write_env(env)

    # Clear cached settings so new values are picked up
    from rebel_forge_backend.core.config import get_settings
    get_settings.cache_clear()

    logger.info("[connections] Updated credentials for %s", platform_id)

    # Return masked values
    creds = {}
    has_any = False
    for field_name, env_var in field_map:
        value = env.get(env_var, "")
        if value and not value.startswith("your-"):
            has_any = True
            creds[field_name] = _mask(value)
        else:
            creds[field_name] = ""

    return ConnectionResponse(
        platform=platform_id,
        connected=has_any,
        credentials=creds,
        fields=[f[0] for f in field_map],
    )


@router.post("/connections/{platform_id}/test")
def test_connection(platform_id: str, _role: str = Depends(require_owner)):
    """Test if credentials work by fetching basic profile info."""
    import httpx

    env = _read_env()
    field_map = PLATFORM_ENV_MAP.get(platform_id)
    if not field_map:
        return {"status": "error", "error": f"Unknown platform: {platform_id}"}

    # Get values
    values = {f: env.get(e, "") for f, e in field_map}

    try:
        if platform_id == "x":
            import requests
            from requests_oauthlib import OAuth1
            auth = OAuth1(values.get("consumer_key", ""), values.get("consumer_secret", ""),
                          values.get("access_token", ""), values.get("access_token_secret", ""))
            r = requests.get("https://api.twitter.com/2/users/me", auth=auth, timeout=10)
            if r.status_code == 200:
                user = r.json().get("data", {})
                return {"status": "ok", "profile": {"username": user.get("username"), "name": user.get("name")}}
            return {"status": "error", "error": f"HTTP {r.status_code}: {r.text[:100]}"}

        elif platform_id == "linkedin":
            r = httpx.get("https://api.linkedin.com/v2/userinfo",
                          headers={"Authorization": f"Bearer {values.get('access_token', '')}"}, timeout=10.0)
            if r.status_code == 200:
                data = r.json()
                return {"status": "ok", "profile": {"name": data.get("name"), "sub": data.get("sub")}}
            return {"status": "error", "error": f"HTTP {r.status_code}"}

        elif platform_id == "facebook":
            r = httpx.get("https://graph.facebook.com/v23.0/me/accounts",
                          params={"access_token": values.get("access_token", "")}, timeout=10.0)
            if r.status_code == 200:
                pages = r.json().get("data", [])
                return {"status": "ok", "profile": {"pages": [p.get("name") for p in pages]}}
            return {"status": "error", "error": f"HTTP {r.status_code}"}

        elif platform_id == "instagram":
            uid = values.get("user_id", "")
            r = httpx.get(f"https://graph.instagram.com/v23.0/{uid}",
                          params={"fields": "id,username", "access_token": values.get("access_token", "")}, timeout=10.0)
            if r.status_code == 200:
                return {"status": "ok", "profile": {"username": r.json().get("username")}}
            return {"status": "error", "error": f"HTTP {r.status_code}: {r.text[:100]}"}

        elif platform_id == "threads":
            r = httpx.get("https://graph.threads.net/v1.0/me",
                          params={"fields": "id,username", "access_token": values.get("access_token", "")}, timeout=10.0)
            if r.status_code == 200:
                return {"status": "ok", "profile": {"username": r.json().get("username")}}
            return {"status": "error", "error": f"HTTP {r.status_code}: {r.text[:100]}"}

        elif platform_id == "vllm":
            base_url = values.get("base_url", "http://127.0.0.1:8000/v1")
            headers = {}
            if values.get("api_key"):
                headers["Authorization"] = f"Bearer {values['api_key']}"
            r = httpx.get(f"{base_url}/models", headers=headers, timeout=5.0)
            if r.status_code == 200:
                models = [m.get("id") for m in r.json().get("data", [])]
                return {"status": "ok", "profile": {"models": models}}
            return {"status": "error", "error": f"HTTP {r.status_code}"}

        elif platform_id == "comfyui":
            base_url = values.get("base_url", "http://127.0.0.1:8188")
            r = httpx.get(f"{base_url}/", timeout=5.0)
            return {"status": "ok" if r.status_code == 200 else "error", "profile": {"reachable": r.status_code == 200}}

        elif platform_id == "firecrawl":
            from rebel_forge_backend.providers.search.firecrawl import FirecrawlProvider
            settings = get_settings()
            fc = FirecrawlProvider(settings)
            results = fc.search("test", limit=1)
            return {"status": "ok", "profile": {"search_works": True, "results": len(results)}}

        elif platform_id == "cloudflare_r2":
            from rebel_forge_backend.services.cloud_storage import CloudStorage
            settings = get_settings()
            cloud = CloudStorage(settings)
            url = cloud.upload_bytes(b"test", "connection_test.txt", "text/plain")
            cloud.delete("connection_test.txt")
            return {"status": "ok", "profile": {"upload_works": True}}

        elif platform_id == "fal_ai":
            api_key = values.get("api_key", "") or get_settings().fal_key
            if not api_key:
                return {"status": "error", "error": "No FAL_KEY configured"}
            model = values.get("model", "") or get_settings().fal_model or "fal-ai/nano-banana-2"
            # Quick test — generate a tiny image
            test_payload: dict = {"prompt": "a small red dot", "num_images": 1}
            if "nano-banana" in model:
                test_payload["resolution"] = "0.5K"
                test_payload["aspect_ratio"] = "1:1"
            else:
                test_payload["image_size"] = "square"
            r = httpx.post(
                f"https://fal.run/{model}",
                headers={"Authorization": f"Key {api_key}", "Content-Type": "application/json"},
                json=test_payload,
                timeout=60.0,
            )
            if r.status_code == 200:
                data = r.json()
                images = data.get("images", [])
                return {"status": "ok", "profile": {"model": model, "image_url": images[0]["url"] if images else None}}
            return {"status": "error", "error": f"HTTP {r.status_code}: {r.text[:150]}"}

        elif platform_id in ("openai", "anthropic", "gemini", "grok"):
            api_key = values.get("api_key", "")
            if not api_key:
                return {"status": "error", "error": "No API key configured"}
            # Just check key format
            return {"status": "ok", "profile": {"key_set": True, "key_preview": _mask(api_key)}}

        else:
            return {"status": "error", "error": "Test not implemented for this platform"}

    except Exception as e:
        return {"status": "error", "error": str(e)}


@router.delete("/connections/{platform_id}")
def delete_connection(platform_id: str, _role: str = Depends(require_owner)):
    """Clear credentials for a platform."""
    if platform_id not in PLATFORM_ENV_MAP:
        raise HTTPException(status_code=404, detail=f"Unknown platform: {platform_id}")

    env = _read_env()
    field_map = PLATFORM_ENV_MAP[platform_id]

    for field_name, env_var in field_map:
        env[env_var] = ""

    _write_env(env)

    from rebel_forge_backend.core.config import get_settings
    get_settings.cache_clear()

    logger.info("[connections] Cleared credentials for %s", platform_id)
    return {"status": "disconnected", "platform": platform_id}
