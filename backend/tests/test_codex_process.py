import asyncio
import json
import subprocess
from pathlib import Path

import pytest

from rebel_forge_backend.core.codex_isolation import (
    CODEX_ISOLATION_ARGS,
    codex_subprocess_environment,
)
from rebel_forge_backend.core.config import Settings
from rebel_forge_backend.providers.llm import codex_cli
from rebel_forge_backend.services import codex_agent


def draft_response(*, count: int = 1) -> str:
    drafts = [
        {
            "platform": "x",
            "concept": f"Concept {index}",
            "caption": f"Caption {index}",
            "hook": "Hook",
            "cta": "Act",
            "hashtags": ["#test"],
            "alt_text": "Alt text",
            "media_prompt": None,
            "script": None,
        }
        for index in range(count)
    ]
    return json.dumps({"drafts": drafts})


def codex_jsonl(message: str) -> str:
    return "\n".join(
        [
            json.dumps(
                {
                    "type": "item.completed",
                    "item": {"type": "agent_message", "text": message},
                }
            ),
            json.dumps({"type": "turn.completed", "usage": {"input_tokens": 10}}),
        ]
    )


def test_codex_environment_excludes_application_credentials(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    secrets = {
        "DATABASE_URL": "postgresql://private",
        "OPENAI_API_KEY": "openai-secret",
        "OPENROUTER_API_KEY": "openrouter-secret",
        "X_ACCESS_TOKEN": "x-secret",
        "AWS_SECRET_ACCESS_KEY": "aws-secret",
        "REBEL_FORGE_OWNER_TOKEN": "owner-secret",
    }
    for key, value in secrets.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("CODEX_HOME", str(tmp_path / "codex-auth"))

    isolated_home = tmp_path / "isolated-home"
    child_env = codex_subprocess_environment(str(isolated_home))

    assert child_env["HOME"] == str(isolated_home)
    assert child_env["CODEX_HOME"] == str(tmp_path / "codex-auth")
    assert set(child_env) == {"CODEX_HOME", "HOME", "LANG", "PATH"}
    assert not set(secrets).intersection(child_env)


def test_codex_draft_provider_uses_isolated_read_only_process(
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed: dict = {}
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-reach-child")
    monkeypatch.setattr(codex_cli, "CODEX_BIN", "/usr/bin/codex-test")

    def fake_run(args, **kwargs):
        observed.update(args=args, **kwargs)
        assert Path(kwargs["cwd"]).is_dir()
        return subprocess.CompletedProcess(
            args=args,
            returncode=0,
            stdout=codex_jsonl(draft_response()),
            stderr="",
        )

    monkeypatch.setattr(codex_cli.subprocess, "run", fake_run)

    submission = codex_cli.CodexCLIProvider(settings).generate_draft_package(
        prompt="Use the stored brand voice",
        count=1,
    )

    args = observed["args"]
    assert submission.drafts[0].caption == "Caption 0"
    assert args[:2] == ["/usr/bin/codex-test", "exec"]
    assert args[-1] == "-"
    assert "--sandbox" in args
    assert args[args.index("--sandbox") + 1] == "read-only"
    assert "--ephemeral" in args
    for isolation_arg in CODEX_ISOLATION_ARGS:
        assert isolation_arg in args
    assert observed["input"].startswith("Use the stored brand voice")
    assert observed["env"]["HOME"] == observed["cwd"]
    assert "OPENAI_API_KEY" not in observed["env"]
    assert not Path(observed["cwd"]).exists()


def test_codex_chat_process_isolated_and_parses_review_only_tool(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed: dict = {}
    monkeypatch.setenv("DATABASE_URL", "must-not-reach-child")
    monkeypatch.setattr(codex_agent, "CODEX_BIN", "/usr/bin/codex-test")
    tool_call = {
        "tool": "generate_drafts",
        "args": {"platform": "x", "count": 1, "brief": "Launch"},
        "summary": "Preparing a draft for review",
    }

    class FakeProcess:
        async def communicate(self, input):
            observed["stdin"] = input
            return codex_jsonl(json.dumps(tool_call)).encode(), b""

    async def fake_create_subprocess_exec(*args, **kwargs):
        observed.update(args=args, **kwargs)
        assert Path(kwargs["cwd"]).is_dir()
        return FakeProcess()

    monkeypatch.setattr(
        codex_agent.asyncio,
        "create_subprocess_exec",
        fake_create_subprocess_exec,
    )

    response = asyncio.run(
        codex_agent.run_codex(
            prompt="Draft a launch post",
            system_prompt="Follow the brand voice",
        )
    )

    assert response.error == ""
    assert response.tool_call == tool_call
    assert observed["args"][0:2] == ("/usr/bin/codex-test", "exec")
    assert observed["args"][-1] == "-"
    assert observed["env"]["HOME"] == observed["cwd"]
    assert "DATABASE_URL" not in observed["env"]
    assert b"This tool never approves or publishes content" in observed["stdin"]
    assert "publish_draft" not in codex_agent.TOOL_PROMPT
    assert not Path(observed["cwd"]).exists()


def test_codex_draft_provider_rejects_wrong_draft_count(
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        codex_cli.subprocess,
        "run",
        lambda args, **kwargs: subprocess.CompletedProcess(
            args=args,
            returncode=0,
            stdout=codex_jsonl(draft_response(count=1)),
            stderr="",
        ),
    )

    with pytest.raises(ValueError, match="exactly 2 were requested"):
        codex_cli.CodexCLIProvider(settings).generate_draft_package(
            prompt="Two drafts",
            count=2,
        )
