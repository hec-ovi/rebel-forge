import json

import httpx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from rebel_forge_backend.api.routes import chat as chat_routes
from rebel_forge_backend.db.models import ContentDraft, DraftStatus, Workspace
from rebel_forge_backend.services.codex_agent import _parse_tool_call
from rebel_forge_backend.services.llm_config import LLMConfig


def add_draft(db: Session, workspace: Workspace) -> ContentDraft:
    draft = ContentDraft(
        workspace_id=workspace.id,
        platform="x",
        status=DraftStatus.DRAFT,
        concept="Safe query result",
        caption="Visible caption",
        hook="Hook",
        cta="CTA",
        hashtags=[],
        alt_text="Alt",
        metadata_json={},
    )
    db.add(draft)
    db.commit()
    return draft


def test_chat_executes_tool_and_feeds_result_to_followup_without_token_cap(
    client: TestClient,
    owner_headers: dict[str, str],
    db: Session,
    workspace: Workspace,
    monkeypatch,
) -> None:
    add_draft(db, workspace)
    requests: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        requests.append(body)
        if len(requests) == 1:
            return httpx.Response(
                200,
                json={
                    "output": [
                        {
                            "type": "function_call",
                            "name": "query_drafts",
                            "call_id": "call-1",
                            "arguments": json.dumps(
                                {
                                    "summary": "Checking drafts",
                                    "resource": "drafts",
                                    "operation": "list",
                                    "platform": "x",
                                }
                            ),
                        }
                    ],
                    "usage": {"input_tokens": 10, "output_tokens": 5},
                },
            )
        return httpx.Response(
            200,
            json={
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": "I found the draft."}],
                    }
                ]
            },
        )

    original_async_client = httpx.AsyncClient
    monkeypatch.setattr(
        chat_routes.httpx,
        "AsyncClient",
        lambda *args, **kwargs: original_async_client(transport=httpx.MockTransport(handler)),
    )
    monkeypatch.setattr(
        httpx,
        "get",
        lambda *args, **kwargs: httpx.Response(503),
    )
    monkeypatch.setattr(
        "rebel_forge_backend.services.llm_config.get_active_llm",
        lambda _db, _settings: LLMConfig(
            provider="openrouter",
            base_url="https://llm.test/v1",
            api_key="test-key",
            model="test-model",
        ),
    )

    response = client.post(
        "/v1/chat",
        headers=owner_headers,
        json={"mode": "general", "messages": [{"role": "user", "content": "Show drafts"}]},
    )

    assert response.status_code == 200
    assert "Safe query result" in response.text
    assert "I found the draft." in response.text
    assert response.text.rstrip().endswith("data: [DONE]")
    assert len(requests) == 2
    assert all("max_output_tokens" not in request for request in requests)
    followup_outputs = [
        item for item in requests[1]["input"] if item.get("type") == "function_call_output"
    ]
    assert followup_outputs == [
        {
            "type": "function_call_output",
            "call_id": "call-1",
            "output": json.dumps(
                [
                    {
                        "id": str(db.query(ContentDraft).one().id),
                        "platform": "x",
                        "status": "draft",
                        "concept": "Safe query result",
                        "caption": "Visible caption",
                        "created_at": db.query(ContentDraft).one().created_at.isoformat(),
                    }
                ]
            ),
        }
    ]


def test_query_tool_rejects_raw_sql_without_executing_it(
    db: Session,
    workspace: Workspace,
    settings,
) -> None:
    result = chat_routes._execute_tool(
        "query_drafts",
        {"sql": "SELECT pg_read_file('/etc/passwd')"},
        settings,
        db,
        workspace,
    )

    assert result == {
        "type": "query_drafts",
        "status": "error",
        "message": "Raw SQL is not supported. Use structured filters.",
    }


def test_draft_tools_cannot_access_another_workspace_by_explicit_id(
    db: Session,
    workspace: Workspace,
    settings,
) -> None:
    other = Workspace(name="Other workspace", slug="other-workspace")
    db.add(other)
    db.flush()
    private_draft = add_draft(db, other)

    approve = chat_routes._execute_tool(
        "approve_draft",
        {"draft_id": str(private_draft.id)},
        settings,
        db,
        workspace,
    )
    publish = chat_routes._execute_tool(
        "publish_draft",
        {"draft_id": str(private_draft.id), "platform": "x"},
        settings,
        db,
        workspace,
    )
    image = chat_routes._execute_tool(
        "generate_image",
        {"draft_id": str(private_draft.id)},
        settings,
        db,
        workspace,
    )

    assert approve["status"] == "error"
    assert publish["status"] == "error"
    assert image == {"type": "generate_image", "status": "error", "message": "No draft found."}
    db.refresh(private_draft)
    assert private_draft.status == DraftStatus.DRAFT


def test_codex_tool_parser_accepts_valid_json_and_rejects_invalid_args() -> None:
    parsed = _parse_tool_call('```json\n{"tool":"query_drafts","args":{"operation":"count"}}\n```')
    invalid = _parse_tool_call('{"tool":"query_drafts","args":"SELECT *"}')

    assert parsed == {"tool": "query_drafts", "args": {"operation": "count"}}
    assert invalid is None
