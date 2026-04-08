from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from rebel_forge_backend.api.auth import require_owner, require_viewer
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.db.session import get_db
from rebel_forge_backend.schemas.brand import BrandProfileUpdate, WorkspaceRead
from rebel_forge_backend.services.workspace import WorkspaceService

router = APIRouter()


@router.get("/workspace", response_model=WorkspaceRead)
def get_workspace(db: Session = Depends(get_db), _role: str = Depends(require_viewer)) -> WorkspaceRead:
    service = WorkspaceService(get_settings())
    workspace = service.get_or_create_primary_workspace(db)
    return WorkspaceRead.model_validate(workspace)


@router.put("/workspace/brand-profile", response_model=WorkspaceRead)
def update_brand_profile(
    payload: BrandProfileUpdate, db: Session = Depends(get_db), _role: str = Depends(require_owner)
) -> WorkspaceRead:
    service = WorkspaceService(get_settings())
    workspace = service.get_or_create_primary_workspace(db)
    service.update_brand_profile(
        db,
        workspace=workspace,
        voice_summary=payload.voice_summary,
        audience_summary=payload.audience_summary,
        goals=payload.goals,
        style_notes=payload.style_notes,
        reference_examples=payload.reference_examples,
    )
    workspace = service.get_or_create_primary_workspace(db)
    return WorkspaceRead.model_validate(workspace)
