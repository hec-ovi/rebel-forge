from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from rebel_forge_backend.db.models import Job, JobStatus, JobType
from rebel_forge_backend.services.events import record_event


class JobService:
    def enqueue_job(
        self,
        db: Session,
        *,
        workspace_id: UUID,
        job_type: JobType,
        input_payload: dict,
    ) -> Job:
        job = Job(
            workspace_id=workspace_id,
            job_type=job_type,
            status=JobStatus.PENDING,
            input_payload=input_payload,
        )
        db.add(job)
        db.flush()
        record_event(
            db,
            workspace_id=workspace_id,
            entity_type="job",
            entity_id=job.id,
            event_type="job.queued",
            payload={"job_type": job_type.value},
        )
        db.commit()
        db.refresh(job)
        return job

    def get_job(self, db: Session, job_id: UUID) -> Job | None:
        return db.get(Job, job_id)

    def list_recent_jobs(self, db: Session, workspace_id: UUID) -> list[Job]:
        query = select(Job).where(Job.workspace_id == workspace_id).order_by(Job.created_at.desc()).limit(20)
        return list(db.scalars(query).all())

    def claim_next_pending_job(self, db: Session) -> Job | None:
        now = datetime.now(UTC)
        query: Select[tuple[Job]] = (
            select(Job)
            .where(Job.status == JobStatus.PENDING, Job.scheduled_for <= now)
            .order_by(Job.created_at.asc())
            .with_for_update(skip_locked=True)
        )
        job = db.scalars(query).first()
        if not job:
            return None
        job.status = JobStatus.RUNNING
        job.started_at = now
        job.attempts += 1
        record_event(
            db,
            workspace_id=job.workspace_id,
            entity_type="job",
            entity_id=job.id,
            event_type="job.started",
            payload={"job_type": job.job_type.value, "attempt": job.attempts},
        )
        db.commit()
        db.refresh(job)
        return job

    def mark_completed(self, db: Session, job: Job, result_payload: dict) -> None:
        job.status = JobStatus.COMPLETED
        job.result_payload = result_payload
        job.error_message = None
        job.completed_at = datetime.now(UTC)
        record_event(
            db,
            workspace_id=job.workspace_id,
            entity_type="job",
            entity_id=job.id,
            event_type="job.completed",
            payload={"job_type": job.job_type.value},
        )

    def mark_failed(self, db: Session, job: Job, error_message: str) -> None:
        job.status = JobStatus.FAILED
        job.error_message = error_message
        job.completed_at = datetime.now(UTC)
        record_event(
            db,
            workspace_id=job.workspace_id,
            entity_type="job",
            entity_id=job.id,
            event_type="job.failed",
            payload={"job_type": job.job_type.value, "error": error_message},
        )
