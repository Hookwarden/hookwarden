"""Tests for target detection + URL templating + pinned-SHA lookup (Plan 04.1-01 §_binary)."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from hookwarden import _binary


def test_detect_target_darwin_arm64(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("platform.system", lambda: "Darwin")
    monkeypatch.setattr("platform.machine", lambda: "arm64")
    assert _binary.detect_target() == ("darwin", "arm64")


def test_detect_target_linux_x64(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("platform.system", lambda: "Linux")
    monkeypatch.setattr("platform.machine", lambda: "x86_64")
    assert _binary.detect_target() == ("linux", "x64")


def test_detect_target_windows_x64(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("platform.system", lambda: "Windows")
    monkeypatch.setattr("platform.machine", lambda: "AMD64")
    assert _binary.detect_target() == ("windows", "x64")


def test_detect_target_unknown_arch_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("platform.system", lambda: "Linux")
    monkeypatch.setattr("platform.machine", lambda: "mips")
    with pytest.raises(RuntimeError, match="unsupported architecture"):
        _binary.detect_target()


def test_release_url_format() -> None:
    url = _binary.release_url(("darwin", "arm64"), "1.2.3")
    assert (
        url
        == "https://github.com/Hookwarden/hookwarden/releases/download/v1.2.3/hookwarden-darwin-arm64"
    )


def test_release_url_windows_has_exe_suffix() -> None:
    url = _binary.release_url(("windows", "x64"), "1.2.3")
    assert url.endswith("hookwarden-windows-x64.exe")


def test_pinned_sha_reads_from_data(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fixture = {"darwin-arm64": "abc123"}
    data_file = tmp_path / "checksums.json"
    data_file.write_text(json.dumps(fixture))
    monkeypatch.setattr(_binary, "_CHECKSUMS_PATH", data_file, raising=False)
    assert _binary.pinned_sha(("darwin", "arm64")) == "abc123"
