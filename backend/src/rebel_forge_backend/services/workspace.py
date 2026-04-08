from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload
from slugify import slugify

from rebel_forge_backend.core.config import Settings
from rebel_forge_backend.db.models import BrandProfile, Workspace
from rebel_forge_backend.services.events import record_event


class WorkspaceService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def get_or_create_primary_workspace(self, db: Session) -> Workspace:
        query = select(Workspace).options(selectinload(Workspace.brand_profile)).limit(1)
        workspace = db.scalars(query).first()
        if workspace:
            return workspace

        workspace = Workspace(
            name=self.settings.default_workspace_name,
            slug=slugify(self.settings.default_workspace_name),
        )
        db.add(workspace)
        db.flush()

        brand_profile = BrandProfile(
            workspace_id=workspace.id,
            voice_summary=None,
            audience_summary=None,
            goals={},
            style_notes={},
            reference_examples=[],
        )
        db.add(brand_profile)
        record_event(
            db,
            workspace_id=workspace.id,
            entity_type="workspace",
            entity_id=workspace.id,
            event_type="workspace.created",
            payload={"name": workspace.name},
        )
        db.commit()
        db.refresh(workspace)
        return db.scalars(query).first()

    def update_brand_profile(
        self,
        db: Session,
        *,
        workspace: Workspace,
        voice_summary: str | None = None,
        audience_summary: str | None = None,
        goals: dict | None = None,
        style_notes: dict | None = None,
        reference_examples: list | None = None,
    ) -> BrandProfile:
        profile = workspace.brand_profile
        if voice_summary is not None:
            profile.voice_summary = voice_summary
        if audience_summary is not None:
            profile.audience_summary = audience_summary
        if goals is not None:
            profile.goals = goals
        if style_notes is not None:
            profile.style_notes = style_notes
        if reference_examples is not None:
            profile.reference_examples = reference_examples
        record_event(
            db,
            workspace_id=workspace.id,
            entity_type="brand_profile",
            entity_id=profile.id,
            event_type="brand_profile.updated",
            payload={
                "has_voice_summary": bool(profile.voice_summary),
                "goals_count": len(profile.goals),
            },
        )
        db.commit()
        db.refresh(profile)
        return profile
