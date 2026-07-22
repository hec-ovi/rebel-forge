from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from rebel_forge_backend.api.routes import share
from rebel_forge_backend.db.models import ContentDraft, DraftStatus, Workspace


def make_draft(db: Session, workspace: Workspace, concept: str) -> ContentDraft:
    draft = ContentDraft(
        workspace_id=workspace.id,
        platform="x",
        status=DraftStatus.DRAFT,
        concept=concept,
        caption="Caption",
        hook="Hook",
        cta="CTA",
        hashtags=[],
        alt_text="Alt",
        metadata_json={},
    )
    db.add(draft)
    db.commit()
    return draft


def test_share_creation_rejects_foreign_workspace_drafts(
    client: TestClient,
    owner_headers: dict[str, str],
    db: Session,
    workspace: Workspace,
    later_workspace: Callable[..., Workspace],
) -> None:
    share._share_store.clear()
    other = later_workspace(name="Other", slug="share-other")
    db.add(other)
    db.flush()
    private = make_draft(db, other, "Private")

    response = client.post(
        "/v1/share",
        headers=owner_headers,
        json={"draft_ids": [str(private.id)], "expires_hours": 24},
    )

    assert response.status_code == 404
    assert not share._share_store


def test_public_share_can_view_and_approve_only_selected_draft(
    client: TestClient,
    owner_headers: dict[str, str],
    db: Session,
    workspace: Workspace,
) -> None:
    share._share_store.clear()
    selected = make_draft(db, workspace, "Selected")
    unselected = make_draft(db, workspace, "Not selected")
    created = client.post(
        "/v1/share",
        headers=owner_headers,
        json={"draft_ids": [str(selected.id)], "expires_hours": 24},
    )
    share_id = created.json()["share_id"]

    public = client.get(f"/v1/share/{share_id}")
    forbidden = client.post(f"/v1/share/{share_id}/approve/{unselected.id}")
    approved = client.post(f"/v1/share/{share_id}/approve/{selected.id}")

    assert created.status_code == 200
    assert [draft["concept"] for draft in public.json()["drafts"]] == ["Selected"]
    assert forbidden.status_code == 403
    assert approved.status_code == 200
    db.refresh(selected)
    db.refresh(unselected)
    assert selected.status == DraftStatus.APPROVED
    assert unselected.status == DraftStatus.DRAFT


def test_share_expiry_is_enforced(
    client: TestClient,
    owner_headers: dict[str, str],
    db: Session,
    workspace: Workspace,
) -> None:
    share._share_store.clear()
    draft = make_draft(db, workspace, "Expires")
    created = client.post(
        "/v1/share",
        headers=owner_headers,
        json={"draft_ids": [str(draft.id)], "expires_hours": 1},
    ).json()
    share._share_store[created["share_id"]]["expires_at"] = (
        datetime.now(UTC) - timedelta(seconds=1)
    ).isoformat()

    response = client.get(f"/v1/share/{created['share_id']}")

    assert response.status_code == 410
    assert created["share_id"] not in share._share_store


def test_share_expiry_hours_are_bounded(
    client: TestClient,
    owner_headers: dict[str, str],
) -> None:
    assert (
        client.post(
            "/v1/share", headers=owner_headers, json={"expires_hours": 0}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/v1/share", headers=owner_headers, json={"expires_hours": 721}
        ).status_code
        == 422
    )
