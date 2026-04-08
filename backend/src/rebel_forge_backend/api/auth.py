import secrets
from pathlib import Path

from fastapi import Depends, HTTPException, Request

TOKEN_FILE = Path(__file__).resolve().parents[2] / "data" / "auth_tokens.json"


def _load_tokens() -> dict:
    import json
    if TOKEN_FILE.exists():
        return json.loads(TOKEN_FILE.read_text())
    # First run — generate tokens and save
    tokens = {
        "owner": secrets.token_urlsafe(32),
        "viewer": secrets.token_urlsafe(32),
    }
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_FILE.write_text(json.dumps(tokens, indent=2))
    return tokens


_tokens: dict | None = None


def get_tokens() -> dict:
    global _tokens
    if _tokens is None:
        _tokens = _load_tokens()
    return _tokens


def _extract_token(request: Request) -> str | None:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


def require_owner(request: Request) -> str:
    token = _extract_token(request)
    tokens = get_tokens()
    if token != tokens["owner"]:
        raise HTTPException(status_code=401, detail="Owner token required")
    return "owner"


def require_viewer(request: Request) -> str:
    token = _extract_token(request)
    tokens = get_tokens()
    if token not in (tokens["owner"], tokens["viewer"]):
        raise HTTPException(status_code=401, detail="Valid token required")
    return "owner" if token == tokens["owner"] else "viewer"


def optional_auth(request: Request) -> str | None:
    """For endpoints that work with or without auth during development."""
    token = _extract_token(request)
    if not token:
        return None
    tokens = get_tokens()
    if token == tokens["owner"]:
        return "owner"
    if token == tokens["viewer"]:
        return "viewer"
    return None
