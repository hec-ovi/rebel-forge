from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from rebel_forge_backend.api.routes import drafts as draft_routes
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.db.models import (
    Asset,
    AssetStatus,
    ContentDraft,
    Correction,
    DraftStatus,
    Event,
    Job,
    JobType,
    Workspace,
)
from rebel_forge_backend.services.storage import LocalAssetStorage


def make_draft(
    db: Session,
    workspace: Workspace,
    *,
    status: DraftStatus = DraftStatus.DRAFT,
    platform: str = "x",
    caption: str = "A real caption",
) -> ContentDraft:
    draft = ContentDraft(
        workspace_id=workspace.id,
        platform=platform,
        status=status,
        concept="Lifecycle coverage",
        caption=caption,
        hook="Hook",
        cta="Act now",
        hashtags=["test"],
        alt_text="Alt text",
        metadata_json={},
    )
    db.add(draft)
    db.commit()
    return draft


def test_generate_route_rejects_removed_auto_publish_contract(
    client: TestClient, owner_headers: dict[str, str]
) -> None:
    response = client.post(
        "/v1/drafts/generate",
        headers=owner_headers,
        json={"platform": "x", "count": 1, "auto_publish": True},
    )

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"][-1] == "auto_publish"


def test_approve_with_edit_persists_status_correction_and_event_atomically(
    client: TestClient,
    owner_headers: dict[str, str],
    db: Session,
    workspace: Workspace,
) -> None:
    draft = make_draft(db, workspace, caption="Before")

    response = client.post(
        f"/v1/drafts/{draft.id}/approve",
        headers=owner_headers,
        json={"caption": "After"},
    )

    assert response.status_code == 200
    db.refresh(draft)
    assert draft.status == DraftStatus.APPROVED
    assert draft.caption == "After"
    correction = db.scalar(select(Correction).where(Correction.draft_id == draft.id))
    assert correction is not None
    assert correction.original_text == "Before"
    assert correction.corrected_text == "After"
    event = db.scalar(
        select(Event).where(Event.entity_id == draft.id, Event.event_type == "draft.approved")
    )
    assert event is not None
    assert event.payload == {"had_edits": True}


def test_approval_event_failure_rolls_back_status_and_caption(
    client: TestClient,
    owner_headers: dict[str, str],
    db: Session,
    workspace: Workspace,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    draft = make_draft(db, workspace, caption="Before")

    def fail_event(*args, **kwargs):
        raise RuntimeError("event storage unavailable")

    monkeypatch.setattr(draft_routes, "record_event", fail_event)
    with pytest.raises(RuntimeError, match="event storage unavailable"):
        client.post(
            f"/v1/drafts/{draft.id}/approve",
            headers=owner_headers,
            json={"caption": "After"},
        )

    db.expire_all()
    unchanged = db.get(ContentDraft, draft.id)
    assert unchanged is not None
    assert unchanged.status == DraftStatus.DRAFT
    assert unchanged.caption == "Before"


def test_reject_and_edit_enforce_state_transitions(
    client: TestClient,
    owner_headers: dict[str, str],
    db: Session,
    workspace: Workspace,
) -> None:
    draft = make_draft(db, workspace, status=DraftStatus.APPROVED)

    edited = client.put(
        f"/v1/drafts/{draft.id}", headers=owner_headers, json={"caption": "Reviewed edit"}
    )
    rejected = client.post(f"/v1/drafts/{draft.id}/reject", headers=owner_headers)
    rejected_again = client.post(f"/v1/drafts/{draft.id}/reject", headers=owner_headers)

    assert edited.status_code == 200
    assert edited.json()["status"] == "draft"
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "failed"
    assert rejected_again.status_code == 409
    events = db.scalars(
        select(Event).where(Event.entity_id == draft.id, Event.event_type == "draft.rejected")
    ).all()
    assert len(events) == 1


def test_delete_draft_removes_rows_and_real_local_asset(
    client: TestClient,
    owner_headers: dict[str, str],
    db: Session,
    workspace: Workspace,
) -> None:
    draft = make_draft(db, workspace)
    storage = LocalAssetStorage(get_settings())
    stored = storage.store_png_base64(
        workspace_id=workspace.id,
        image_b64="iVBORw0KGgo=",
    )
    target = storage.base_path / stored.storage_path
    asset = Asset(
        workspace_id=workspace.id,
        draft_id=draft.id,
        provider="test",
        status=AssetStatus.READY,
        prompt="Test image",
        storage_path=stored.storage_path,
        public_url=stored.public_url,
        metadata_json={},
    )
    correction = Correction(
        workspace_id=workspace.id,
        draft_id=draft.id,
        original_text="Before",
        corrected_text="After",
        context={},
    )
    db.add_all([asset, correction])
    db.commit()

    response = client.delete(f"/v1/drafts/{draft.id}", headers=owner_headers)

    assert response.status_code == 200
    assert not target.exists()
    assert db.get(ContentDraft, draft.id) is None
    assert db.scalar(select(func.count()).select_from(Asset)) == 0
    assert db.scalar(select(func.count()).select_from(Correction)) == 0
    deleted = db.scalar(
        select(Event).where(Event.entity_id == draft.id, Event.event_type == "draft.deleted")
    )
    assert deleted is not None


def test_delete_draft_never_follows_asset_path_traversal(
    client: TestClient,
    owner_headers: dict[str, str],
    db: Session,
    workspace: Workspace,
    tmp_path: Path,
) -> None:
    draft = make_draft(db, workspace)
    outside = tmp_path / "outside.txt"
    outside.write_text("must survive")
    db.add(
        Asset(
            workspace_id=workspace.id,
            draft_id=draft.id,
            provider="test",
            status=AssetStatus.READY,
            prompt="Traversal",
            storage_path="../../outside.txt",
            metadata_json={},
        )
    )
    db.commit()

    response = client.delete(f"/v1/drafts/{draft.id}", headers=owner_headers)

    assert response.status_code == 200
    assert outside.read_text() == "must survive"


def test_media_generation_rejects_draft_from_another_workspace(
    client: TestClient,
    owner_headers: dict[str, str],
    db: Session,
    workspace: Workspace,
    later_workspace: Callable[..., Workspace],
) -> None:
    """`workspace` is created first so it resolves as primary; the draft below is not in it."""
    other = later_workspace(name="Other", slug="other-media")
    db.add(other)
    db.commit()
    private = make_draft(db, other)

    response = client.post(
        "/v1/media/generate",
        headers=owner_headers,
        json={"draft_id": str(private.id), "prompt": "Do not enqueue"},
    )

    assert response.status_code == 404
    assert db.scalar(select(func.count()).select_from(Job).where(Job.job_type == JobType.MEDIA_GENERATION)) == 0
