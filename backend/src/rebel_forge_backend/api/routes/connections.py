"""
Connections management — read and update platform API credentials.
Reads from .env file, writes back to .env file.
No database needed — .env is the source of truth for credentials.
"""

import logging
import os
import re
import tempfile
import threading
from pathlib import Path

from dotenv import dotenv_values
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from rebel_forge_backend.api.auth import require_owner
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.core.env_values import decode_env_value, encode_env_value
from rebel_forge_backend.core.integrations import META_GRAPH_API_VERSION, X_API_BASE

logger = logging.getLogger("rebel_forge_backend.connections")

router = APIRouter()

ENV_PATH = Path(__file__).resolve().parents[4] / ".env"
_ENV_WRITE_LOCK = threading.Lock()

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
    "openai": [
        ("api_key", "OPENAI_API_KEY"),
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

REQUIRED_CONNECTION_FIELDS = {
    "x": {"consumer_key", "consumer_secret", "access_token", "access_token_secret"},
    "linkedin": {"access_token"},
    "facebook": {"access_token"},
    "instagram": {"access_token", "user_id"},
    "threads": {"access_token", "user_id"},
    "openai": {"api_key"},
    "grok": {"api_key"},
    "openrouter": {"api_key"},
    "vllm": {"base_url", "model"},
    "firecrawl": {"api_key"},
    "cloudflare_r2": {
        "endpoint_url",
        "access_key_id",
        "secret_access_key",
        "bucket_name",
        "public_url",
    },
    "comfyui": {"base_url"},
    "fal_ai": {"api_key", "model"},
}


def _is_real_value(value: str) -> bool:
    return bool(value) and not value.startswith("your-")


def _is_configured(platform_id: str, values: dict[str, str], env: dict[str, str]) -> bool:
    required = REQUIRED_CONNECTION_FIELDS[platform_id]
    if platform_id in {"vllm", "comfyui"}:
        persisted_fields = {
            field
            for field, env_var in PLATFORM_ENV_MAP[platform_id]
            if _is_real_value(env.get(env_var, ""))
        }
        if not required.issubset(persisted_fields):
            return False
    return all(_is_real_value(values.get(field, "")) for field in required)


def _read_env() -> dict[str, str]:
    """Read all key=value pairs from .env file."""
    if not ENV_PATH.exists():
        return {}
    parsed = dotenv_values(ENV_PATH, interpolate=False)
    return {
        key: decode_env_value(value or "")
        for key, value in parsed.items()
        if key is not None
    }


def _write_env(env: dict[str, str]) -> None:
    """Write key=value pairs back to .env file, preserving comments and order."""
    if not ENV_PATH.exists():
        raise HTTPException(
            status_code=503,
            detail=(
                f"Credential persistence is unavailable because {ENV_PATH} does not exist. "
                "Create or mount a writable backend .env file, then restart the API and worker."
            ),
        )

    lines = ENV_PATH.read_text(encoding="utf-8").splitlines()
    new_lines = []
    written_keys = set()
    assignment = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=")

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            new_lines.append(line)
            continue
        match = assignment.match(line)
        if match:
            key = match.group(1)
            if key in env:
                new_lines.append(f"{key}={encode_env_value(env[key])}")
                written_keys.add(key)
            else:
                new_lines.append(line)
        else:
            new_lines.append(line)

    # Append any new keys not already in the file
    for key, value in env.items():
        if key not in written_keys:
            new_lines.append(f"{key}={encode_env_value(value)}")

    temp_path: Path | None = None
    try:
        with _ENV_WRITE_LOCK:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=ENV_PATH.parent,
                prefix=f".{ENV_PATH.name}.",
                delete=False,
            ) as temporary:
                temp_path = Path(temporary.name)
                os.fchmod(temporary.fileno(), 0o600)
                temporary.write("\n".join(new_lines) + "\n")
                temporary.flush()
                os.fsync(temporary.fileno())
            os.replace(temp_path, ENV_PATH)
            temp_path = None
    except OSError as exc:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=503,
            detail=f"Credential persistence failed for {ENV_PATH}: {exc}",
        ) from exc


def _mask(value: str) -> str:
    """Mask a credential for display."""
    if not value:
        return ""
    if len(value) <= 8:
        return "****"
    return "****" + value[-4:]


def _configured_value(env: dict[str, str], env_var: str, settings) -> str:
    """Read a persisted value, falling back to the process configuration."""
    return env.get(env_var, "") or str(getattr(settings, env_var.lower(), ""))


# Fields that are not secrets — show full value
_NON_SECRET_FIELDS = {
    "api_url",
    "base_url",
    "bucket_name",
    "channel_id",
    "endpoint_url",
    "model",
    "page_id",
    "person_id",
    "public_url",
    "user_id",
}


class ConnectionResponse(BaseModel):
    platform: str
    connected: bool
    credentials: dict[str, str]  # masked values
    fields: list[str]
    recreate_required: bool = False


class ConnectionUpdate(BaseModel):
    credentials: dict[str, str]

    @field_validator("credentials")
    @classmethod
    def reject_env_line_injection(cls, credentials: dict[str, str]) -> dict[str, str]:
        for value in credentials.values():
            if any(character in value for character in ("\r", "\n", "\0")):
                raise ValueError("Credential values cannot contain line breaks or NUL bytes")
        return credentials


@router.get("/connections")
def list_connections(_role: str = Depends(require_owner)):
    """List all platforms with connection status."""
    env = _read_env()
    settings = get_settings()
    result = []

    for platform_id, field_map in PLATFORM_ENV_MAP.items():
        creds = {}
        values = {}
        for field_name, env_var in field_map:
            value = _configured_value(env, env_var, settings)
            values[field_name] = value
            if _is_real_value(value):
                creds[field_name] = value if field_name in _NON_SECRET_FIELDS else _mask(value)
            else:
                creds[field_name] = ""

        result.append(
            {
                "platform": platform_id,
                "connected": _is_configured(platform_id, values, env),
                "credentials": creds,
                "fields": [f[0] for f in field_map],
            }
        )

    return result


@router.get("/connections/{platform_id}", response_model=ConnectionResponse)
def get_connection(platform_id: str, _role: str = Depends(require_owner)):
    """Get connection details for a specific platform. Values are masked."""
    if platform_id not in PLATFORM_ENV_MAP:
        raise HTTPException(status_code=404, detail=f"Unknown platform: {platform_id}")

    env = _read_env()
    settings = get_settings()
    field_map = PLATFORM_ENV_MAP[platform_id]

    creds = {}
    values = {}
    for field_name, env_var in field_map:
        value = _configured_value(env, env_var, settings)
        values[field_name] = value
        if _is_real_value(value):
            creds[field_name] = value if field_name in _NON_SECRET_FIELDS else _mask(value)
        else:
            creds[field_name] = ""

    return ConnectionResponse(
        platform=platform_id,
        connected=_is_configured(platform_id, values, env),
        credentials=creds,
        fields=[f[0] for f in field_map],
    )


@router.put("/connections/{platform_id}", response_model=ConnectionResponse)
def update_connection(
    platform_id: str, payload: ConnectionUpdate, _role: str = Depends(require_owner)
):
    """Update credentials for a platform in a writable backend .env file."""
    if platform_id not in PLATFORM_ENV_MAP:
        raise HTTPException(status_code=404, detail=f"Unknown platform: {platform_id}")

    env = _read_env()
    field_map = PLATFORM_ENV_MAP[platform_id]
    allowed_fields = {field_name for field_name, _ in field_map}
    unknown_fields = set(payload.credentials) - allowed_fields
    if unknown_fields:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown credential fields: {', '.join(sorted(unknown_fields))}",
        )

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
    values = {}
    for field_name, env_var in field_map:
        value = env.get(env_var, "")
        values[field_name] = value
        if _is_real_value(value):
            creds[field_name] = value if field_name in _NON_SECRET_FIELDS else _mask(value)
        else:
            creds[field_name] = ""

    return ConnectionResponse(
        platform=platform_id,
        connected=_is_configured(platform_id, values, env),
        credentials=creds,
        fields=[f[0] for f in field_map],
        recreate_required=True,
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
    settings = get_settings()
    values = {field: _configured_value(env, env_var, settings) for field, env_var in field_map}

    try:
        if platform_id == "x":
            import requests
            from requests_oauthlib import OAuth1

            auth = OAuth1(
                values.get("consumer_key", ""),
                values.get("consumer_secret", ""),
                values.get("access_token", ""),
                values.get("access_token_secret", ""),
            )
            r = requests.get(f"{X_API_BASE}/users/me", auth=auth, timeout=10)
            if r.status_code == 200:
                user = r.json().get("data", {})
                return {
                    "status": "ok",
                    "profile": {"username": user.get("username"), "name": user.get("name")},
                }
            return {"status": "error", "error": f"HTTP {r.status_code}: {r.text[:100]}"}

        elif platform_id == "linkedin":
            r = httpx.get(
                "https://api.linkedin.com/v2/userinfo",
                headers={"Authorization": f"Bearer {values.get('access_token', '')}"},
                timeout=10.0,
            )
            if r.status_code == 200:
                data = r.json()
                return {
                    "status": "ok",
                    "profile": {"name": data.get("name"), "sub": data.get("sub")},
                }
            return {"status": "error", "error": f"HTTP {r.status_code}"}

        elif platform_id == "facebook":
            r = httpx.get(
                f"https://graph.facebook.com/{META_GRAPH_API_VERSION}/me/accounts",
                params={"access_token": values.get("access_token", "")},
                timeout=10.0,
            )
            if r.status_code == 200:
                pages = r.json().get("data", [])
                return {"status": "ok", "profile": {"pages": [p.get("name") for p in pages]}}
            return {"status": "error", "error": f"HTTP {r.status_code}"}

        elif platform_id == "instagram":
            uid = values.get("user_id", "")
            r = httpx.get(
                f"https://graph.instagram.com/{META_GRAPH_API_VERSION}/{uid}",
                params={"fields": "id,username", "access_token": values.get("access_token", "")},
                timeout=10.0,
            )
            if r.status_code == 200:
                return {"status": "ok", "profile": {"username": r.json().get("username")}}
            return {"status": "error", "error": f"HTTP {r.status_code}: {r.text[:100]}"}

        elif platform_id == "threads":
            r = httpx.get(
                f"https://graph.threads.net/{META_GRAPH_API_VERSION}/me",
                params={"fields": "id,username", "access_token": values.get("access_token", "")},
                timeout=10.0,
            )
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
            return {
                "status": "ok" if r.status_code == 200 else "error",
                "profile": {"reachable": r.status_code == 200},
            }

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
            cloud.upload_bytes(b"test", "connection_test.txt", "text/plain")
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
                return {
                    "status": "ok",
                    "profile": {"model": model, "image_url": images[0]["url"] if images else None},
                }
            return {"status": "error", "error": f"HTTP {r.status_code}: {r.text[:150]}"}

        elif platform_id in ("openai", "grok", "openrouter"):
            api_key = values.get("api_key", "")
            if not api_key:
                return {"status": "error", "error": "No API key configured"}
            provider_urls = {
                "openai": "https://api.openai.com/v1",
                "grok": "https://api.x.ai/v1",
                "openrouter": "https://openrouter.ai/api/v1",
            }
            r = httpx.get(
                f"{provider_urls[platform_id]}/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=10.0,
            )
            if r.status_code == 200:
                models = [item.get("id") for item in r.json().get("data", [])[:5]]
                return {"status": "ok", "profile": {"models": models}}
            return {"status": "error", "error": f"HTTP {r.status_code}: {r.text[:100]}"}

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

    for _field_name, env_var in field_map:
        env[env_var] = ""

    _write_env(env)

    from rebel_forge_backend.core.config import get_settings

    get_settings.cache_clear()

    logger.info("[connections] Cleared credentials for %s", platform_id)
    return {"status": "disconnected", "platform": platform_id}
