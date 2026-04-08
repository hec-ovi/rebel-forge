import logging
import time

from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.core.logging import configure_logging
from rebel_forge_backend.db.session import SessionLocal
from rebel_forge_backend.services.jobs import JobService
from rebel_forge_backend.services.orchestration import JobOrchestrator
from rebel_forge_backend.services.heartbeat import HeartbeatService
from rebel_forge_backend.services.workspace import WorkspaceService


def _auto_approve_and_publish(db, workspace_id, result_payload, settings, logger):
    """If auto-approve is enabled, approve and publish new drafts automatically."""
    from rebel_forge_backend.db.models import ContentDraft, DraftStatus, Workspace
    from rebel_forge_backend.services.events import record_event

    workspace = db.get(Workspace, workspace_id)
    if not workspace or not workspace.brand_profile:
        return

    bp = workspace.brand_profile
    hb_config = (bp.style_notes or {}).get("heartbeat", {})
    if not hb_config.get("auto_approve", False):
        return

    draft_ids = result_payload.get("draft_ids", [])
    if not draft_ids:
        return

    logger.info("[auto] Auto-approve enabled, processing %d drafts", len(draft_ids))

    for draft_id in draft_ids:
        draft = db.get(ContentDraft, draft_id)
        if not draft or draft.status != DraftStatus.DRAFT.value:
            continue

        # Approve
        draft.status = DraftStatus.APPROVED
        db.commit()
        record_event(db, workspace_id=workspace_id, entity_type="content_draft",
                     entity_id=draft.id, event_type="draft.approved",
                     payload={"auto_approved": True})
        db.commit()
        logger.info("[auto] Draft %s auto-approved", draft_id)

        # Publish to primary platform
        platform = draft.platform.lower()
        try:
            from rebel_forge_backend.api.routes.publish import PUBLISHERS
            publish_fn = PUBLISHERS.get(platform, PUBLISHERS.get("x"))
            if publish_fn:
                pub_result = publish_fn(draft, settings, db)
                if pub_result.success:
                    draft.status = DraftStatus.PUBLISHED
                    db.commit()
                    logger.info("[auto] Draft %s auto-published to %s: %s", draft_id, platform, pub_result.url)
                else:
                    logger.warning("[auto] Draft %s publish failed: %s", draft_id, pub_result.error)
        except Exception as e:
            logger.error("[auto] Draft %s publish error: %s", draft_id, e)


def run_worker() -> None:
    configure_logging()
    logger = logging.getLogger("rebel_forge_backend.worker")
    settings = get_settings()
    jobs = JobService()
    orchestrator = None  # Created per-job to pick up active provider
    heartbeat = HeartbeatService(settings)
    workspace_service = WorkspaceService(settings)

    heartbeat_check_counter = 0
    HEARTBEAT_CHECK_INTERVAL = 30  # Check every 30 poll cycles (~60s)

    logger.info("[worker] Started with heartbeat support")

    while True:
        try:
            # Process pending jobs
            with SessionLocal() as db:
                job = jobs.claim_next_pending_job(db)

            if job is not None:
                with SessionLocal() as db:
                    fresh_job = jobs.get_job(db, job.id)
                    if fresh_job is None:
                        continue
                    max_retries = 3 if fresh_job.job_type == "draft_generation" else 1
                    orch = JobOrchestrator(settings, db=db)
                    for attempt in range(max_retries):
                        try:
                            result_payload = orch.process(db, fresh_job)
                            jobs.mark_completed(db, fresh_job, result_payload)
                            db.commit()

                            # Auto-approve + auto-publish if enabled
                            if fresh_job.job_type == "draft_generation":
                                _auto_approve_and_publish(db, fresh_job.workspace_id, result_payload, settings, logger)

                            break
                        except Exception as exc:
                            if attempt < max_retries - 1:
                                logger.warning("Job %s attempt %d failed, retrying: %s", fresh_job.id, attempt + 1, exc)
                                continue
                            jobs.mark_failed(db, fresh_job, str(exc))
                            db.commit()
                            logger.exception("Job %s failed after %d attempts", fresh_job.id, max_retries)
                continue  # Check for more jobs immediately

            # No pending jobs — check heartbeat
            heartbeat_check_counter += 1
            if heartbeat_check_counter >= HEARTBEAT_CHECK_INTERVAL:
                heartbeat_check_counter = 0
                try:
                    with SessionLocal() as db:
                        workspace = workspace_service.get_or_create_primary_workspace(db)
                        bp = workspace.brand_profile
                        hb_config = (bp.style_notes or {}).get("heartbeat", {}) if bp else {}
                        hb_enabled = hb_config.get("enabled", False)
                        hb_hours = hb_config.get("interval_hours", 6)

                        # Check for manual trigger (heartbeat.requested event)
                        from sqlalchemy import select
                        from rebel_forge_backend.db.models import Event
                        manual_request = db.scalars(
                            select(Event)
                            .where(Event.workspace_id == workspace.id)
                            .where(Event.event_type == "heartbeat.requested")
                            .order_by(Event.created_at.desc())
                            .limit(1)
                        ).first()

                        last_completed = db.scalars(
                            select(Event)
                            .where(Event.workspace_id == workspace.id)
                            .where(Event.event_type == "heartbeat.completed")
                            .order_by(Event.created_at.desc())
                            .limit(1)
                        ).first()

                        # Run if manually requested (and not already completed after the request)
                        manually_triggered = (
                            manual_request is not None
                            and (last_completed is None or manual_request.created_at > last_completed.created_at)
                        )

                        should_run = manually_triggered or (
                            hb_enabled and heartbeat.should_run(db, workspace.id, interval_hours=hb_hours)
                        )

                        if should_run:
                            trigger = "manual" if manually_triggered else f"scheduled ({hb_hours}h)"
                            logger.info("[worker] Heartbeat triggered (%s)", trigger)
                            try:
                                result = heartbeat.run(db, workspace)
                                logger.info("[worker] Heartbeat result: %d drafts created",
                                            result.get("drafts_created", 0))
                            except Exception:
                                logger.exception("[worker] Heartbeat cycle failed")
                                # Always record completion so we don't retry forever
                                from rebel_forge_backend.services.events import record_event
                                record_event(db, workspace_id=workspace.id,
                                             entity_type="workspace", entity_id=workspace.id,
                                             event_type="heartbeat.completed",
                                             payload={"error": "heartbeat cycle failed"})
                                db.commit()
                except Exception:
                    logger.exception("[worker] Heartbeat check failed")

            time.sleep(settings.worker_poll_interval_seconds)

        except Exception:
            logger.exception("Worker loop failed")
            time.sleep(settings.worker_poll_interval_seconds)


if __name__ == "__main__":
    run_worker()
