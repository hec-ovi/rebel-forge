from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from rebel_forge_backend.api.auth import get_tokens

router = APIRouter()


class LoginRequest(BaseModel):
    password: str


class LoginResponse(BaseModel):
    token: str
    role: str


class TokensResponse(BaseModel):
    owner_token: str
    viewer_token: str
    message: str


@router.post("/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest):
    tokens = get_tokens()
    # Owner can login with the owner token as password
    if payload.password == tokens["owner"]:
        return LoginResponse(token=tokens["owner"], role="owner")
    if payload.password == tokens["viewer"]:
        return LoginResponse(token=tokens["viewer"], role="viewer")
    raise HTTPException(status_code=401, detail="Invalid credentials")


@router.get("/auth/tokens", response_model=TokensResponse)
def show_tokens():
    """Development endpoint — shows generated tokens. Remove in production."""
    tokens = get_tokens()
    return TokensResponse(
        owner_token=tokens["owner"],
        viewer_token=tokens["viewer"],
        message="Use the owner token as your Bearer token. Share the viewer token with clients for read-only access.",
    )
