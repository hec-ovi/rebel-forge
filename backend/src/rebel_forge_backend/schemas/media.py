from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class MediaGenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=1)
    size: Literal[
        "512x512",
        "1024x1024",
        "1024x768",
        "1280x720",
        "768x1024",
        "720x1280",
        "1536x1024",
        "1024x1536",
    ] = "1024x1024"
    draft_id: UUID | None = None

    @field_validator("prompt")
    @classmethod
    def strip_prompt(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Prompt cannot be blank")
        return value


class AssetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    draft_id: UUID | None
    provider: str
    status: str
    prompt: str
    external_url: str | None
    storage_path: str | None
    public_url: str | None
    metadata_json: dict
