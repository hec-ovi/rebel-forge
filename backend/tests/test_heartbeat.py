from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from rebel_forge_backend.db.models import Event


def test_manual_heartbeat_is_queued_once_for_worker(
    client: TestClient,
    owner_headers: dict[str, str],
    db: Session,
) -> None:
    response = client.post("/v1/heartbeat/trigger", headers=owner_headers)

    assert response.status_code == 202
    assert response.json()["status"] == "queued"
    requests = db.scalars(select(Event).where(Event.event_type == "heartbeat.requested")).all()
    assert len(requests) == 1
    assert requests[0].payload == {"triggered_by": "api"}
