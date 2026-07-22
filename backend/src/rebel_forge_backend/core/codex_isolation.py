import os
from pathlib import Path


def codex_subprocess_environment(isolated_home: str) -> dict[str, str]:
    """Build a minimal CLI environment without backend/provider credentials."""
    codex_home = os.environ.get("CODEX_HOME") or str(Path.home() / ".codex")
    return {
        "CODEX_HOME": codex_home,
        "HOME": isolated_home,
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "PATH": os.environ.get("PATH", os.defpath),
    }


CODEX_ISOLATION_ARGS = [
    "--ignore-user-config",
    "--ignore-rules",
    "--disable",
    "shell_tool",
    "-c",
    "shell_environment_policy.inherit=none",
]
