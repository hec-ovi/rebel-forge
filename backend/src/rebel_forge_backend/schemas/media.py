from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class MediaGenerationRequest(BaseModel):
    prompt: str
    size: str = Field(default="1024x1024")
    draft_id: UUID | None = None


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

