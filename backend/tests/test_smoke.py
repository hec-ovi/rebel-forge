import os
import subprocess
import sys
from pathlib import Path

import boto3
import pgvector
import websocket
from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def test_application_import_has_no_filesystem_side_effect(tmp_path: Path) -> None:
    storage = tmp_path / "not-created-on-import"
    env = os.environ | {
        "STORAGE_BASE_PATH": str(storage),
        "DATA_BASE_PATH": str(tmp_path / "data"),
        "PROMPTS_BASE_PATH": str(BACKEND_ROOT / "prompts"),
    }

    result = subprocess.run(
        [sys.executable, "-c", "from rebel_forge_backend.main import app; print(app.title)"],
        cwd=BACKEND_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "Rebel Forge Backend"
    assert not storage.exists()


def test_alembic_revision_chain_loads_with_one_head() -> None:
    config = Config(BACKEND_ROOT / "alembic.ini")
    script = ScriptDirectory.from_config(config)
    revisions = list(script.walk_revisions())

    assert script.get_current_head() == "20260718_0006"
    assert [revision.revision for revision in revisions] == [
        "20260718_0006",
        "20260328_0005",
        "20260322_0004",
        "20260321_0003",
        "20260319_0002",
        "20260317_0001",
    ]


def test_vector_migration_enables_required_extension() -> None:
    migration = (BACKEND_ROOT / "alembic/versions/20260319_0002_add_corrections.py").read_text()

    assert 'op.execute("CREATE EXTENSION IF NOT EXISTS vector")' in migration


def test_advertised_optional_runtime_dependencies_are_installed() -> None:
    assert boto3.__name__ == "boto3"
    assert pgvector.__name__ == "pgvector"
    assert websocket.__name__ == "websocket"


def test_llm_requests_and_prompts_do_not_impose_output_caps() -> None:
    files = [
        *BACKEND_ROOT.glob("src/**/*.py"),
        *BACKEND_ROOT.glob("prompts/*.md"),
        BACKEND_ROOT / ".env.example",
    ]
    content = "\n".join(path.read_text(encoding="utf-8") for path in files)
    forbidden = (
        "max_output_tokens",
        "max_tokens",
        "maxOutputTokens",
        "maxTokens",
        "Keep responses under",
        "Maximum 1 sentence",
    )

    assert all(value not in content for value in forbidden)


def test_dockerfile_uses_frozen_lockfile_and_copies_prompts() -> None:
    dockerfile = (BACKEND_ROOT / "Dockerfile").read_text()

    assert "COPY pyproject.toml uv.lock README.md ./" in dockerfile
    assert dockerfile.count("uv sync --frozen --no-dev") == 2
    assert "COPY prompts ./prompts" in dockerfile
