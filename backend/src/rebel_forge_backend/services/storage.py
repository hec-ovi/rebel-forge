import base64
import uuid
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from rebel_forge_backend.core.config import Settings


@dataclass
class StoredAsset:
    storage_path: str
    public_url: str
    content_type: str


class LocalAssetStorage:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.base_path = Path(settings.storage_base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)

    def store_png_base64(self, *, workspace_id: UUID, image_b64: str) -> StoredAsset:
        image_bytes = base64.b64decode(image_b64)
        target_dir = self.base_path / str(workspace_id) / "images"
        target_dir.mkdir(parents=True, exist_ok=True)
        filename = f"{uuid.uuid4()}.png"
        file_path = target_dir / filename
        file_path.write_bytes(image_bytes)
        relative_path = file_path.relative_to(self.base_path).as_posix()
        public_url = f"{self.settings.public_asset_base_url.rstrip('/')}/{relative_path}"
        return StoredAsset(storage_path=relative_path, public_url=public_url, content_type="image/png")

