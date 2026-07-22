from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class DraftRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    platform: str
    status: str
    concept: str
    brief: str | None
    caption: str
    hook: str
    cta: str
    hashtags: list[str]
    alt_text: str
    media_prompt: str | None
    script: str | None
    created_at: datetime
    updated_at: datetime


class DraftGenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    platform: str = "instagram"
    objective: str = "increase engagement"
    count: int = Field(default=2, ge=1, le=7)
    brief: str | None = None
    context_notes: str | None = None
    auto_approve: bool = False
    generate_image: bool | None = None  # None = platform default

    @field_validator("platform")
    @classmethod
    def normalize_platform(cls, v: str) -> str:
        normalized = v.strip().lower()
        aliases = {"twitter": "x", "fb": "facebook", "ig": "instagram"}
        normalized = aliases.get(normalized, normalized)
        supported = {"x", "linkedin", "facebook", "instagram", "threads"}
        if normalized not in supported:
            raise ValueError(f"Unsupported platform: {v}")
        return normalized

    @field_validator("brief", "context_notes")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Value cannot be blank")
        return value


class DraftUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    caption: str | None = Field(default=None, min_length=1)
    hook: str | None = Field(default=None, min_length=1)
    cta: str | None = Field(default=None, min_length=1)
    concept: str | None = Field(default=None, min_length=1)

    @field_validator("caption", "hook", "cta", "concept")
    @classmethod
    def strip_content(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Draft content cannot be blank")
        return value


class DraftPackageItem(BaseModel):
    platform: str
    concept: str
    caption: str
    hook: str
    cta: str
    hashtags: list[str]
    alt_text: str
    media_prompt: str | None = None
    script: str | None = None

    @field_validator("hashtags")
    @classmethod
    def ensure_hashtags(cls, value: list[str]) -> list[str]:
        return [tag.strip() for tag in value if tag and tag.strip()]


class DraftPackageSubmission(BaseModel):
    drafts: list[DraftPackageItem]
