import secrets

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from rebel_forge_backend.api.auth import get_tokens

router = APIRouter()


class LoginRequest(BaseModel):
    password: str


class LoginResponse(BaseModel):
    token: str
    role: str


@router.post("/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest):
    tokens = get_tokens()
    # Owner can login with the owner token as password
    if secrets.compare_digest(payload.password, tokens["owner"]):
        return LoginResponse(token=tokens["owner"], role="owner")
    if secrets.compare_digest(payload.password, tokens["viewer"]):
        return LoginResponse(token=tokens["viewer"], role="viewer")
    raise HTTPException(status_code=401, detail="Invalid credentials")
