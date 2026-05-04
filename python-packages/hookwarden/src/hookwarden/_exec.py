"""os.execv wrapper with arg passthrough.

POSIX: os.execv replaces the Python process with the binary, so the user sees
the binary's exit code directly (Pitfall 7). Windows: os.execv has known stdio
inheritance issues — fall back to subprocess.run and propagate the returncode.
Pre-commit on Windows is deferred per CONTEXT (Out of scope).
"""
from __future__ import annotations

import os
from pathlib import Path


def exec_binary(binary_path: Path, args: list[str]) -> int:
    cmd = [str(binary_path), *args]
    if os.name == "nt":
        import subprocess

        return subprocess.run(cmd).returncode
    os.execv(str(binary_path), cmd)
    return 0
