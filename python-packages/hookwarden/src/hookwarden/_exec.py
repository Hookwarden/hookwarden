"""os.execv wrapper with arg passthrough.

POSIX: os.execv replaces the Python process with the binary, so the user sees
the binary's exit code directly (Pitfall 7). Windows: os.execv has known stdio
inheritance issues — fall back to subprocess.run and propagate the returncode.
Pre-commit on Windows is deferred per CONTEXT (Out of scope).
"""
from __future__ import annotations

from pathlib import Path


def exec_binary(binary_path: Path, args: list[str]) -> int:
    """os.execv(str(binary_path), [str(binary_path), *args]).

    On Windows: falls back to subprocess.run(...).returncode.
    """
    raise NotImplementedError("Plan 04.1-01 Task 2")
