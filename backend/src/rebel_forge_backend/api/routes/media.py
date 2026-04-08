from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from rebel_forge_backend.api.auth import require_owner
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.db.models import JobType
from rebel_forge_backend.db.session import get_db
from rebel_forge_backend.schemas.jobs import JobRead
from rebel_forge_backend.schemas.media import MediaGenerationRequest
from rebel_forge_backend.services.jobs import JobService
from rebel_forge_backend.services.workspace import WorkspaceService

router = APIRouter()


@router.post("/media/generate", response_model=JobRead)
def generate_media(
    payload: MediaGenerationRequest, db: Session = Depends(get_db), _role: str = Depends(require_owner)
) -> JobRead:
    workspace = WorkspaceService(get_settings()).get_or_create_primary_workspace(db)
    job = JobService().enqueue_job(
        db,
        workspace_id=workspace.id,
        job_type=JobType.MEDIA_GENERATION,
        input_payload=payload.model_dump(mode="json"),
    )
    return JobRead.model_validate(job)
