import base64
import logging
import uuid
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from sqlalchemy import event
from sqlalchemy.orm import Session

from rebel_forge_backend.core.config import Settings
from rebel_forge_backend.core.paths import resolve_runtime_path

logger = logging.getLogger("rebel_forge_backend.storage")

_PENDING_FILES_KEY = "rebel_forge_pending_local_asset_files"


@dataclass
class StoredAsset:
    storage_path: str
    public_url: str
    content_type: str


class LocalAssetStorage:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.base_path = resolve_runtime_path(settings.storage_base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)

    def store_png_base64(self, *, workspace_id: UUID, image_b64: str) -> StoredAsset:
        image_bytes = base64.b64decode(image_b64, validate=True)
        target_dir = self.base_path / str(workspace_id) / "images"
        target_dir.mkdir(parents=True, exist_ok=True)
        filename = f"{uuid.uuid4()}.png"
        file_path = target_dir / filename
        file_path.write_bytes(image_bytes)
        relative_path = file_path.relative_to(self.base_path).as_posix()
        public_url = f"{self.settings.public_asset_base_url.rstrip('/')}/{relative_path}"
        return StoredAsset(
            storage_path=relative_path, public_url=public_url, content_type="image/png"
        )

    def track_until_commit(self, db: Session, storage_path: str) -> None:
        """Remove a newly written file automatically if its DB transaction rolls back."""
        pending = db.info.setdefault(_PENDING_FILES_KEY, set())
        pending.add((str(self.base_path), storage_path))

    def delete(self, storage_path: str) -> bool:
        """Delete one relative asset path without allowing traversal outside storage."""
        if not storage_path or Path(storage_path).is_absolute():
            raise ValueError("Asset storage path must be relative")
        base = self.base_path.resolve()
        target = (base / storage_path).resolve(strict=False)
        try:
            target.relative_to(base)
        except ValueError as exc:
            raise ValueError("Asset storage path escapes the storage directory") from exc
        if target == base:
            raise ValueError("Asset storage path must identify a file")
        if not target.exists():
            return False
        if not target.is_file():
            raise ValueError("Asset storage path does not identify a file")
        target.unlink()
        parent = target.parent
        while parent != base:
            try:
                parent.rmdir()
            except OSError:
                break
            parent = parent.parent
        return True


@event.listens_for(Session, "after_commit")
def _clear_committed_asset_files(session: Session) -> None:
    session.info.pop(_PENDING_FILES_KEY, None)


@event.listens_for(Session, "after_rollback")
def _remove_rolled_back_asset_files(session: Session) -> None:
    for base_path, storage_path in session.info.pop(_PENDING_FILES_KEY, set()):
        try:
            settings = Settings(storage_base_path=Path(base_path))
            LocalAssetStorage(settings).delete(storage_path)
        except Exception as exc:
            logger.warning("Could not clean rolled-back asset %s: %s", storage_path, exc)
