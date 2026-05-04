"""platformdirs path conventions on Linux/macOS/Windows (Plan 04.1-01 §_cache.cache_dir_for)."""
from __future__ import annotations

import importlib

import pytest

import hookwarden._cache as cache_mod


def test_paths_for_linux(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path / "xdg"))
    monkeypatch.setattr("sys.platform", "linux")
    importlib.reload(cache_mod)
    resolved = cache_mod.cache_dir_for(("linux", "x64"))
    assert str(resolved).startswith(str(tmp_path / "xdg" / "hookwarden"))


def test_paths_for_macos(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("sys.platform", "darwin")
    importlib.reload(cache_mod)
    resolved = cache_mod.cache_dir_for(("darwin", "arm64"))
    assert "Library/Caches/hookwarden" in str(resolved)


def test_paths_for_windows(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setattr("sys.platform", "win32")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    importlib.reload(cache_mod)
    resolved = cache_mod.cache_dir_for(("windows", "x64"))
    assert "hookwarden" in str(resolved)
