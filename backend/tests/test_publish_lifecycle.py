import httpx
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.db.models import (
    ContentDraft,
    DraftStatus,
    Event,
    PublishedPost,
    PublishJob,
    PublishStatus,
    Workspace,
)
from rebel_forge_backend.providers.publishers.x_twitter import PublishResult, XPublisher


def make_approved_draft(db: Session, workspace: Workspace) -> ContentDraft:
    draft = ContentDraft(
        workspace_id=workspace.id,
        platform="x",
        status=DraftStatus.APPROVED,
        concept="Publish boundary",
        caption="Ship with evidence",
        hook="Hook",
        cta="Read more",
        hashtags=["testing"],
        alt_text="Alt",
        metadata_json={},
    )
    db.add(draft)
    db.commit()
    return draft


def configure_x(monkeypatch) -> None:
    monkeypatch.setenv("X_CONSUMER_KEY", "consumer")
    monkeypatch.setenv("X_CONSUMER_SECRET", "secret")
    monkeypatch.setenv("X_ACCESS_TOKEN", "token")
    monkeypatch.setenv("X_ACCESS_TOKEN_SECRET", "token-secret")
    get_settings.cache_clear()


def test_publish_success_persists_claim_result_event_and_blocks_duplicate(
    client: TestClient,
    owner_headers: dict[str, str],
    db: Session,
    workspace: Workspace,
    monkeypatch,
) -> None:
    configure_x(monkeypatch)
    draft = make_approved_draft(db, workspace)
    calls = []

    def publish(self, text: str) -> PublishResult:
        calls.append(text)
        return PublishResult(
            success=True,
            platform_post_id="remote-1",
            url="https://x.com/i/web/status/remote-1",
        )

    monkeypatch.setattr(XPublisher, "publish_text", publish)

    first = client.post(f"/v1/drafts/{draft.id}/publish", headers=owner_headers)
    second = client.post(f"/v1/drafts/{draft.id}/publish", headers=owner_headers)

    assert first.status_code == 200
    assert first.json()["success"] is True
    assert second.status_code == 409
    assert len(calls) == 1
    db.refresh(draft)
    assert draft.status == DraftStatus.PUBLISHED
    job = db.scalar(select(PublishJob).where(PublishJob.draft_id == draft.id))
    assert job is not None
    assert job.status == PublishStatus.PUBLISHED
    assert job.response_payload == {"url": "https://x.com/i/web/status/remote-1"}
    post = db.scalar(select(PublishedPost).where(PublishedPost.draft_id == draft.id))
    assert post is not None
    assert post.platform_post_id == "remote-1"
    assert db.scalar(
        select(func.count())
        .select_from(Event)
        .where(Event.entity_id == draft.id, Event.event_type == "draft.published")
    ) == 1


def test_definitive_provider_failure_is_retryable(
    client: TestClient,
    owner_headers: dict[str, str],
    db: Session,
    workspace: Workspace,
    monkeypatch,
) -> None:
    configure_x(monkeypatch)
    draft = make_approved_draft(db, workspace)
    outcomes = [
        PublishResult(success=False, error="X API 400: invalid request"),
        PublishResult(success=True, platform_post_id="remote-2", url="https://x.test/remote-2"),
    ]

    monkeypatch.setattr(XPublisher, "publish_text", lambda self, text: outcomes.pop(0))

    failed = client.post(f"/v1/drafts/{draft.id}/publish", headers=owner_headers)
    job = db.scalar(select(PublishJob).where(PublishJob.draft_id == draft.id))
    assert failed.status_code == 200
    assert failed.json() == {
        "success": False,
        "platform": "x",
        "url": None,
        "error": "X API 400: invalid request",
        "ambiguous": False,
    }
    assert job is not None
    assert job.status == PublishStatus.FAILED

    retried = client.post(f"/v1/drafts/{draft.id}/publish", headers=owner_headers)

    assert retried.status_code == 200
    assert retried.json()["success"] is True
    db.refresh(job)
    assert job.status == PublishStatus.PUBLISHED


def test_ambiguous_timeout_stays_sent_and_cannot_duplicate_remote_post(
    client: TestClient,
    owner_headers: dict[str, str],
    db: Session,
    workspace: Workspace,
    monkeypatch,
) -> None:
    configure_x(monkeypatch)
    draft = make_approved_draft(db, workspace)
    calls = 0

    def timeout(self, text: str):
        nonlocal calls
        calls += 1
        raise httpx.ReadTimeout("provider outcome unknown")

    monkeypatch.setattr(XPublisher, "publish_text", timeout)

    first = client.post(f"/v1/drafts/{draft.id}/publish", headers=owner_headers)
    second = client.post(f"/v1/drafts/{draft.id}/publish", headers=owner_headers)

    assert first.status_code == 502
    assert second.status_code == 409
    assert calls == 1
    job = db.scalar(select(PublishJob).where(PublishJob.draft_id == draft.id))
    assert job is not None
    assert job.status == PublishStatus.SENT
    assert "outcome unknown" in (job.error_message or "")
    db.refresh(draft)
    assert draft.status == DraftStatus.APPROVED


def test_publish_rejects_wrong_platform_and_over_limit_content_before_provider(
    client: TestClient,
    owner_headers: dict[str, str],
    db: Session,
    workspace: Workspace,
    monkeypatch,
) -> None:
    configure_x(monkeypatch)
    draft = make_approved_draft(db, workspace)
    draft.caption = "x" * 281
    db.commit()
    monkeypatch.setattr(
        XPublisher,
        "publish_text",
        lambda self, text: (_ for _ in ()).throw(AssertionError("provider must not be called")),
    )

    wrong = client.post(
        f"/v1/drafts/{draft.id}/publish?platform=linkedin", headers=owner_headers
    )
    oversized = client.post(f"/v1/drafts/{draft.id}/publish", headers=owner_headers)

    assert wrong.status_code == 409
    assert oversized.status_code == 422
    assert db.scalar(select(func.count()).select_from(PublishJob)) == 0
