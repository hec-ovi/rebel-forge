from typing import Any

PRIVATE_STYLE_NOTE_KEYS = frozenset({"llm_provider", "connections"})


def public_style_notes(style_notes: dict[str, Any] | None) -> dict[str, Any]:
    """Return content preferences without provider configuration or credentials."""
    return {
        key: value
        for key, value in (style_notes or {}).items()
        if key not in PRIVATE_STYLE_NOTE_KEYS
    }


def merge_public_style_notes(
    existing: dict[str, Any] | None,
    updates: dict[str, Any],
) -> dict[str, Any]:
    """Replace public preferences while preserving private provider settings."""
    private = {
        key: value
        for key, value in (existing or {}).items()
        if key in PRIVATE_STYLE_NOTE_KEYS
    }
    return dict(updates) | private
