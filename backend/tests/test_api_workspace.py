from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from rebel_forge_backend.db.models import Event, Workspace


def test_viewer_can_read_workspace_but_cannot_update_it(
    client: TestClient,
    viewer_headers: dict[str, str],
) -> None:
    read = client.get("/v1/workspace", headers=viewer_headers)
    update = client.put(
        "/v1/workspace/brand-profile",
        headers=viewer_headers,
        json={"voice_summary": "Changed"},
    )

    assert read.status_code == 200
    assert read.json()["name"] == "Primary Workspace"
    assert update.status_code == 403


def test_owner_updates_brand_profile_through_http_entrypoint(
    client: TestClient,
    owner_headers: dict[str, str],
    db: Session,
) -> None:
    response = client.put(
        "/v1/workspace/brand-profile",
        headers=owner_headers,
        json={
            "voice_summary": "Technical and direct",
            "audience_summary": "Staff engineers",
            "goals": {"primary": "Teach"},
            "style_notes": {"tone": ["plain"]},
            "reference_examples": ["Example"],
        },
    )

    assert response.status_code == 200
    profile = response.json()["brand_profile"]
    assert profile["voice_summary"] == "Technical and direct"
    assert profile["goals"] == {"primary": "Teach"}
    workspace = db.scalar(select(Workspace))
    events = db.scalars(
        select(Event).where(Event.workspace_id == workspace.id).order_by(Event.created_at)
    ).all()
    assert [event.event_type for event in events] == [
        "workspace.created",
        "brand_profile.updated",
    ]
