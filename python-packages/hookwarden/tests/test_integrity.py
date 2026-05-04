"""DC-04 hard-fail on SHA mismatch (Plan 04.1-01 §_fetch IntegrityError)."""
from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from hookwarden import _fetch


def test_sha_mismatch_hard_fail(mock_releases_server, tmp_path: Path) -> None:
    server, url = mock_releases_server
    body = b"correct-bytes"
    server.responses = [(200, body), (200, body), (200, body)]

    wrong_sha = hashlib.sha256(b"different-bytes").hexdigest()
    dest = tmp_path / "binary"

    with pytest.raises(_fetch.IntegrityError):
        _fetch.download_and_verify(url, wrong_sha, dest, base_backoff=0.0)

    assert not dest.exists(), "tampered download must not be persisted"
    assert len(server.responses) == 2, "MUST NOT retry on SHA mismatch (DC-04)"
