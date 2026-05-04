"""Cache-directory resolution, filelock, and atomic write.

Cache lives under platformdirs.user_cache_dir('hookwarden'), NOT next to the
package install (Pitfall 1). Filelock serializes concurrent writers; atomic
write via tempfile + os.replace prevents partial-cache poisoning (Watch Out
For #18 — os.replace, not os.rename, for Windows atomicity).
"""
from __future__ import annotations

import contextlib
import hashlib
import os
import tempfile
from pathlib import Path
from typing import Iterable

from filelock import FileLock
from platformdirs import user_cache_dir

from . import __version__


def cache_dir_for(target: tuple[str, str]) -> Path:
    del target  # cache layout is per-version, not per-target
    base = Path(user_cache_dir("hookwarden"))
    return base / __version__ / "bin"


def lock(directory: Path) -> FileLock:
    directory.mkdir(parents=True, exist_ok=True)
    return FileLock(str(directory / ".lock"), timeout=120)


def is_valid(binary_path: Path, expected_sha: str) -> bool:
    if not binary_path.exists() or not binary_path.is_file():
        return False
    h = hashlib.sha256()
    with binary_path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest() == expected_sha


def atomic_write(target: Path, content_iter: Iterable[bytes]) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as tmp:
            tmp_path = Path(tmp.name)
            for chunk in content_iter:
                tmp.write(chunk)
            tmp.flush()
            os.fsync(tmp.fileno())
    except BaseException:
        if tmp_path is not None:
            with contextlib.suppress(OSError):
                tmp_path.unlink()
        raise
    os.replace(tmp_path, target)
