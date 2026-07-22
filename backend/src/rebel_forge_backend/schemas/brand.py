from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_serializer

from rebel_forge_backend.core.style_notes import public_style_notes


class BrandProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    voice_summary: str | None
    audience_summary: str | None
    goals: dict[str, Any]
    style_notes: dict[str, Any]
    reference_examples: list[Any]

    @field_serializer("style_notes")
    def redact_private_style_notes(self, value: dict[str, Any]) -> dict[str, Any]:
        """Never expose provider credentials through workspace responses."""
        return public_style_notes(value)


class BrandProfileUpdate(BaseModel):
    voice_summary: str | None = None
    audience_summary: str | None = None
    goals: dict[str, Any] | None = None
    style_notes: dict[str, Any] | None = None
    reference_examples: list[Any] | None = None


class WorkspaceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str
    brand_profile: BrandProfileRead
