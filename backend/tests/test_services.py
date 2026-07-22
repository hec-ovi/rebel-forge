import base64
import binascii
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from rebel_forge_backend.core.config import Settings
from rebel_forge_backend.core.paths import data_path, prompts_path, resolve_runtime_path
from rebel_forge_backend.db.models import (
    ContentDraft,
    DraftStatus,
    Event,
    Job,
    JobStatus,
    JobType,
    Workspace,
)
from rebel_forge_backend.schemas.drafts import DraftGenerationRequest, DraftPackageItem
from rebel_forge_backend.services.draft_query import query_workspace_content
from rebel_forge_backend.services.jobs import JobService
from rebel_forge_backend.services.storage import LocalAssetStorage


def make_draft(workspace_id, *, platform: str, concept: str) -> ContentDraft:
    return ContentDraft(
        workspace_id=workspace_id,
        platform=platform,
        status=DraftStatus.DRAFT,
        concept=concept,
        caption=f"Caption for {concept}",
        hook="Hook",
        cta="Act",
        hashtags=["#test"],
        alt_text="Alt text",
        metadata_json={},
    )


def test_runtime_paths_are_consistent_and_prompt_files_exist(settings: Settings) -> None:
    assert data_path(settings, "training") == settings.data_base_path / "training"
    assert prompts_path(settings, "general.md").is_file()
    assert prompts_path(settings, "comfyui_workflow.json").is_file()
    assert resolve_runtime_path("data/example").is_absolute()


def test_local_asset_storage_writes_decoded_png(settings: Settings, workspace: Workspace) -> None:
    png = b"\x89PNG\r\n\x1a\ncontent"
    stored = LocalAssetStorage(settings).store_png_base64(
        workspace_id=workspace.id,
        image_b64=base64.b64encode(png).decode(),
    )

    target = settings.storage_base_path / stored.storage_path
    assert target.read_bytes() == png
    assert stored.public_url == f"http://testserver/assets/{stored.storage_path}"
    assert stored.content_type == "image/png"


def test_local_asset_storage_rejects_invalid_base64(
    settings: Settings, workspace: Workspace
) -> None:
    storage = LocalAssetStorage(settings)

    with pytest.raises(binascii.Error):
        storage.store_png_base64(workspace_id=workspace.id, image_b64="not base64!!!")


def test_job_lifecycle_records_observable_events(db: Session, workspace: Workspace) -> None:
    service = JobService()
    job = service.enqueue_job(
        db,
        workspace_id=workspace.id,
        job_type=JobType.DRAFT_GENERATION,
        input_payload={"platform": "x"},
    )
    claimed = service.claim_next_pending_job(db)

    assert claimed.id == job.id
    assert claimed.status == JobStatus.RUNNING
    assert claimed.attempts == 1

    service.mark_completed(db, claimed, {"draft_ids": ["one"]})
    db.commit()
    db.refresh(claimed)
    assert claimed.status == JobStatus.COMPLETED
    assert claimed.result_payload == {"draft_ids": ["one"]}
    assert claimed.completed_at is not None
    events = db.scalars(
        select(Event).where(Event.entity_id == job.id).order_by(Event.created_at)
    ).all()
    assert [event.event_type for event in events] == [
        "job.queued",
        "job.started",
        "job.completed",
    ]


def test_mark_failed_clears_no_error_context(db: Session, workspace: Workspace) -> None:
    job = Job(
        workspace_id=workspace.id,
        job_type=JobType.MEDIA_GENERATION,
        status=JobStatus.RUNNING,
        input_payload={},
        attempts=1,
        scheduled_for=datetime.now(UTC),
    )
    db.add(job)
    db.flush()

    JobService().mark_failed(db, job, "provider unavailable")
    db.commit()

    assert job.status == JobStatus.FAILED
    assert job.error_message == "provider unavailable"
    event = db.scalar(select(Event).where(Event.entity_id == job.id))
    assert event.event_type == "job.failed"


def test_structured_query_is_workspace_scoped(db: Session, workspace: Workspace) -> None:
    other = Workspace(name="Other", slug="other")
    db.add(other)
    db.flush()
    db.add_all(
        [
            make_draft(workspace.id, platform="x", concept="Visible alpha"),
            make_draft(workspace.id, platform="linkedin", concept="Visible beta"),
            make_draft(other.id, platform="x", concept="Private alpha"),
        ]
    )
    db.commit()

    listed = query_workspace_content(
        db,
        workspace_id=workspace.id,
        platform="x",
        search="alpha",
        limit=50,
    )
    counted = query_workspace_content(
        db,
        workspace_id=workspace.id,
        operation="count",
    )

    assert [item["concept"] for item in listed["results"]] == ["Visible alpha"]
    assert counted == {"count": 2}


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"resource": "secrets"}, "Unsupported resource"),
        ({"operation": "delete"}, "Unsupported operation"),
        ({"status": "unknown"}, "Unsupported draft status"),
        ({"resource": "published_posts", "status": "published"}, "only supported for drafts"),
    ],
)
def test_structured_query_rejects_unapproved_shapes(
    db: Session,
    workspace: Workspace,
    kwargs: dict,
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message):
        query_workspace_content(db, workspace_id=workspace.id, **kwargs)


def test_draft_request_normalizes_platform_and_count() -> None:
    request = DraftGenerationRequest(platform="  LinkedIn ", count="3")

    assert request.platform == "linkedin"
    assert request.count == 3
    with pytest.raises(ValueError, match="valid integer"):
        DraftGenerationRequest(count="invalid")
    with pytest.raises(ValueError, match="Extra inputs are not permitted"):
        DraftGenerationRequest(auto_publish=True)


def test_draft_item_removes_empty_hashtags_without_silently_truncating() -> None:
    item = DraftPackageItem(
        platform="x",
        concept="Concept",
        caption="Caption",
        hook="Hook",
        cta="CTA",
        hashtags=[" #one ", "", *[f"#{index}" for index in range(20)]],
        alt_text="Alt",
    )

    assert item.hashtags[0] == "#one"
    assert len(item.hashtags) == 21
