import stat
from pathlib import Path

from fastapi.testclient import TestClient

from rebel_forge_backend.api.routes import connections


def test_missing_env_file_cannot_report_success(
    client: TestClient,
    owner_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    missing = tmp_path / "missing.env"
    monkeypatch.setattr(connections, "ENV_PATH", missing)

    response = client.put(
        "/v1/connections/x",
        headers=owner_headers,
        json={"credentials": {"consumer_key": "key"}},
    )

    assert response.status_code == 503
    assert "does not exist" in response.json()["detail"]
    assert not missing.exists()


def test_connection_update_persists_masks_secrets_and_preserves_public_values(
    client: TestClient,
    owner_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("LLM_BASE_URL=http://old/v1\nLLM_MODEL=old\nLLM_API_KEY=old-secret\n")
    monkeypatch.setattr(connections, "ENV_PATH", env_file)

    response = client.put(
        "/v1/connections/vllm",
        headers=owner_headers,
        json={
            "credentials": {
                "base_url": "http://new/v1",
                "model": "new-model",
                "api_key": "new-secret-value",
            }
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["credentials"] == {
        "base_url": "http://new/v1",
        "model": "new-model",
        "api_key": "****alue",
    }
    assert body["recreate_required"] is True
    assert "LLM_API_KEY=new-secret-value" in env_file.read_text()
    assert stat.S_IMODE(env_file.stat().st_mode) == 0o600


def test_connection_update_rejects_env_injection_and_unknown_fields(
    client: TestClient,
    owner_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("X_CONSUMER_KEY=old\n")
    monkeypatch.setattr(connections, "ENV_PATH", env_file)

    injected = client.put(
        "/v1/connections/x",
        headers=owner_headers,
        json={"credentials": {"consumer_key": "safe\nINJECTED=value"}},
    )
    unknown = client.put(
        "/v1/connections/x",
        headers=owner_headers,
        json={"credentials": {"not_a_field": "value"}},
    )

    assert injected.status_code == 422
    assert unknown.status_code == 422
    assert env_file.read_text() == "X_CONSUMER_KEY=old\n"


def test_provider_activation_round_trip_reports_configured_without_exposing_key(
    client: TestClient,
    owner_headers: dict[str, str],
) -> None:
    switched = client.put(
        "/v1/providers/active",
        headers=owner_headers,
        json={
            "provider": "openrouter",
            "model": "openai/gpt-4.1",
            "api_key": "provider-secret",
        },
    )
    listed = client.get("/v1/providers", headers=owner_headers)

    assert switched.status_code == 200
    assert listed.status_code == 200
    body = listed.json()
    openrouter = next(item for item in body["providers"] if item["id"] == "openrouter")
    assert openrouter["active"] is True
    assert openrouter["configured"] is True
    assert "provider-secret" not in listed.text


def test_reselecting_provider_preserves_existing_api_key(
    client: TestClient,
    owner_headers: dict[str, str],
) -> None:
    client.put(
        "/v1/providers/active",
        headers=owner_headers,
        json={"provider": "openrouter", "api_key": "keep-me", "model": "first"},
    )
    client.put(
        "/v1/providers/active",
        headers=owner_headers,
        json={"provider": "openrouter", "model": "second"},
    )

    listed = client.get("/v1/providers", headers=owner_headers).json()
    openrouter = next(item for item in listed["providers"] if item["id"] == "openrouter")
    assert openrouter["configured"] is True
    assert listed["active_model"] == "second"
