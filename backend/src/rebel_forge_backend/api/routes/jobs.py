from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from rebel_forge_backend.api.auth import require_viewer
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.db.session import get_db
from rebel_forge_backend.schemas.jobs import JobRead
from rebel_forge_backend.services.jobs import JobService
from rebel_forge_backend.services.workspace import WorkspaceService

router = APIRouter()


@router.get("/jobs/{job_id}", response_model=JobRead)
def get_job(
    job_id: UUID, db: Session = Depends(get_db), _role: str = Depends(require_viewer)
) -> JobRead:
    workspace = WorkspaceService(get_settings()).get_or_create_primary_workspace(db)
    job = JobService().get_job(db, job_id)
    if job is None or job.workspace_id != workspace.id:
        raise HTTPException(status_code=404, detail="Job not found.")
    return JobRead.model_validate(job)
