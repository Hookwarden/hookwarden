"""Tests for download + verify + retry (Plan 04.1-01 §_fetch)."""
from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from hookwarden import _fetch


def test_download_streams_and_verifies(mock_releases_server, tmp_path: Path) -> None:
    server, url = mock_releases_server
    body = b"binary-bytes-content"
    server.responses = [(200, body)]
    expected_sha = hashlib.sha256(body).hexdigest()
    dest = tmp_path / "binary"

    _fetch.download_and_verify(url, expected_sha, dest)

    assert dest.exists()
    assert dest.read_bytes() == body


def test_download_retries_on_5xx(mock_releases_server, tmp_path: Path) -> None:
    server, url = mock_releases_server
    body = b"binary-bytes-content"
    server.responses = [(503, b""), (503, b""), (200, body)]
    expected_sha = hashlib.sha256(body).hexdigest()
    dest = tmp_path / "binary"

    _fetch.download_and_verify(url, expected_sha, dest, base_backoff=0.0)

    assert dest.exists()
    assert dest.read_bytes() == body
    assert server.responses == []


def test_download_does_not_retry_on_4xx(mock_releases_server, tmp_path: Path) -> None:
    server, url = mock_releases_server
    server.responses = [(404, b""), (200, b"should-never-reach")]
    dest = tmp_path / "binary"

    with pytest.raises(Exception):
        _fetch.download_and_verify(url, "0" * 64, dest, base_backoff=0.0)

    assert len(server.responses) == 1, "must NOT retry after 4xx"
    assert not dest.exists()
