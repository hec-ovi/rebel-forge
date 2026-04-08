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
    platform: str = "instagram"
    objective: str = "increase engagement"
    count: int = Field(default=2, ge=1, le=7)
    brief: str | None = None
    context_notes: str | None = None
    auto_approve: bool = False
    auto_publish: bool = False  # implies auto_approve
    generate_image: bool | None = None  # None = platform default

    @field_validator("platform")
    @classmethod
    def normalize_platform(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("count", mode="before")
    @classmethod
    def coerce_count(cls, v: object) -> int:
        try:
            return int(v)
        except (TypeError, ValueError):
            return 2


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
        cleaned = [tag.strip() for tag in value if tag and tag.strip()]
        return cleaned[:12]


class DraftPackageSubmission(BaseModel):
    drafts: list[DraftPackageItem]

