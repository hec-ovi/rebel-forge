from pathlib import Path

from rebel_forge_backend.core.config import Settings

BACKEND_ROOT = Path(__file__).resolve().parents[3]


def resolve_runtime_path(path: str | Path) -> Path:
    """Resolve configured relative paths from the backend project root."""
    candidate = Path(path).expanduser()
    if candidate.is_absolute():
        return candidate
    return (BACKEND_ROOT / candidate).resolve()


def data_path(settings: Settings, *parts: str) -> Path:
    return resolve_runtime_path(settings.data_base_path).joinpath(*parts)


def prompts_path(settings: Settings, *parts: str) -> Path:
    return resolve_runtime_path(settings.prompts_base_path).joinpath(*parts)
