from collections.abc import Callable, Generator
from datetime import datetime, timedelta
from itertools import count
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from rebel_forge_backend.api import auth
from rebel_forge_backend.core.config import Settings, get_settings
from rebel_forge_backend.db.base import Base
from rebel_forge_backend.db.models import Workspace
from rebel_forge_backend.services.workspace import WorkspaceService

BACKEND_ROOT = Path(__file__).resolve().parents[1]
EPOCH = datetime(2026, 1, 1)
FAR_FUTURE = datetime(2099, 1, 1)


@pytest.fixture(autouse=True)
def isolated_runtime(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> Generator[None, None, None]:
    monkeypatch.setenv("DATA_BASE_PATH", str(tmp_path / "data"))
    monkeypatch.setenv("STORAGE_BASE_PATH", str(tmp_path / "data" / "assets"))
    monkeypatch.setenv("PROMPTS_BASE_PATH", str(BACKEND_ROOT / "prompts"))
    monkeypatch.setenv("APP_ENV", "test")
    get_settings.cache_clear()
    auth.clear_token_cache()
    yield
    auth.clear_token_cache()
    get_settings.cache_clear()


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        _env_file=None,
        app_env="test",
        data_base_path=tmp_path / "data",
        prompts_base_path=BACKEND_ROOT / "prompts",
        storage_base_path=tmp_path / "data" / "assets",
        public_asset_base_url="http://testserver/assets",
        database_url="sqlite+pysqlite:///:memory:",
    )


@pytest.fixture
def db() -> Generator[Session, None, None]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    # Postgres server defaults have no SQLite equivalent, so they are emulated here.
    # The clock advances one second per call so `ORDER BY created_at` reflects insert order.
    clock = count()

    @event.listens_for(engine, "connect")
    def configure_sqlite(connection, _record) -> None:
        def stamp() -> str:
            return (EPOCH + timedelta(seconds=next(clock))).strftime("%Y-%m-%d %H:%M:%S")

        connection.execute("PRAGMA foreign_keys=ON")
        connection.create_function("clock_timestamp", 0, stamp)
        connection.create_function("now", 0, stamp)
        # SQLAlchemy stores UUIDs as 32-char hex on SQLite, so emit the same form.
        connection.create_function("gen_random_uuid", 0, lambda: uuid4().hex)

    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    session = factory()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture
def workspace(db: Session, settings: Settings) -> Workspace:
    return WorkspaceService(settings).get_or_create_primary_workspace(db)


@pytest.fixture
def later_workspace() -> Callable[..., Workspace]:
    """Build a workspace stamped after the primary one.

    `created_at` defaults to CURRENT_TIMESTAMP under SQLite, which only has
    second resolution, so an explicit timestamp is what keeps "the oldest
    workspace is the primary one" deterministic in tests.
    """

    def build(*, name: str, slug: str) -> Workspace:
        return Workspace(name=name, slug=slug, created_at=FAR_FUTURE)

    return build


@pytest.fixture
def tokens() -> dict[str, str]:
    value = {"owner": "owner-test-token", "viewer": "viewer-test-token"}
    auth._tokens = value
    return value


@pytest.fixture
def client(db: Session, tokens: dict[str, str]) -> Generator[TestClient, None, None]:
    from rebel_forge_backend.db.session import get_db
    from rebel_forge_backend.main import app

    def override_db() -> Generator[Session, None, None]:
        try:
            yield db
        except Exception:
            db.rollback()
            raise

    app.dependency_overrides[get_db] = override_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def owner_headers(tokens: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['owner']}"}


@pytest.fixture
def viewer_headers(tokens: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['viewer']}"}
