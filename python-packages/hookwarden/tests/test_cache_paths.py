"""platformdirs path conventions on Linux/macOS/Windows (Plan 04.1-01 §_cache.cache_dir_for).

Each test runs only on its native platform because platformdirs resolves cache
paths via OS-level APIs at import time — monkeypatching sys.platform after the
fact does not retarget the resolution. CI matrix coverage is per-platform: the
Linux runner exercises test_paths_for_linux, macOS exercises test_paths_for_macos,
and a Windows runner (when added) exercises test_paths_for_windows.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

from hookwarden import _cache


@pytest.mark.skipif(sys.platform != "linux", reason="Linux-native platformdirs path")
def test_paths_for_linux(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path / "xdg"))
    resolved = _cache.cache_dir_for(("linux", "x64"))
    assert str(resolved).startswith(str(tmp_path / "xdg" / "hookwarden"))


@pytest.mark.skipif(sys.platform != "darwin", reason="macOS-native platformdirs path")
def test_paths_for_macos() -> None:
    resolved = _cache.cache_dir_for(("darwin", "arm64"))
    assert "Library/Caches/hookwarden" in str(resolved)


@pytest.mark.skipif(sys.platform != "win32", reason="Windows-native platformdirs path")
def test_paths_for_windows(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    resolved = _cache.cache_dir_for(("windows", "x64"))
    assert "hookwarden" in str(resolved)
