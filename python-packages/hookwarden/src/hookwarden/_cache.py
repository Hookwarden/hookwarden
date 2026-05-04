"""Cache-directory resolution, filelock, and atomic write.

Cache lives under platformdirs.user_cache_dir('hookwarden'), NOT next to the
package install (Pitfall 1 — venv-relative caches break for user-site installs
and break read-only system installs). Filelock serializes concurrent writers;
atomic write via tempfile + os.replace prevents partial-cache poisoning.
"""
from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Iterable

if TYPE_CHECKING:
    from filelock import FileLock


def cache_dir_for(target: tuple[str, str]) -> Path:
    """Return platformdirs.user_cache_dir('hookwarden') / version / 'bin'.

    Linux: ~/.cache/hookwarden/<v>/bin/
    macOS: ~/Library/Caches/hookwarden/<v>/bin/
    Windows: %LOCALAPPDATA%\\hookwarden\\<v>\\bin\\
    """
    raise NotImplementedError("Plan 04.1-01 Task 2")


def lock(directory: Path) -> "FileLock":
    """Return a FileLock on <directory>/.lock; caller uses as context manager."""
    raise NotImplementedError("Plan 04.1-01 Task 2")


def is_valid(binary_path: Path, expected_sha: str) -> bool:
    """Return True iff file exists AND streaming sha256 matches. False otherwise."""
    raise NotImplementedError("Plan 04.1-01 Task 2")


def atomic_write(target: Path, content_iter: Iterable[bytes]) -> None:
    """Write via tempfile.NamedTemporaryFile(dir=target.parent) + os.replace(tmp, target)."""
    raise NotImplementedError("Plan 04.1-01 Task 2")
