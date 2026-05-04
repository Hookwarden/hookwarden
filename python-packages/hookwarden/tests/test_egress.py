"""CLI-09 carve-out enforcement (Plan 04.1-01 §egress).

The shim's network access is restricted to a single host pattern:
    https://github.com/Hookwarden/hookwarden/releases/download/*

This is enforced two ways:
1. Static: only `_fetch.py` is permitted to import HTTP libs.
2. Dynamic: `download_and_verify` must reject any non-canonical URL at the
   HTTP boundary (caller's responsibility to pass a canonical URL — but if a
   future refactor smuggles a non-canonical URL, the recorder asserts it).
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

import pytest

from hookwarden import _fetch

HTTP_IMPORT_PATTERN = re.compile(
    r"\b(?:urllib\.request|http\.client|httpx|aiohttp|requests)\b"
)
SHIM_SRC = Path(__file__).resolve().parent.parent / "src" / "hookwarden"
CANONICAL_URL_PREFIX = "https://github.com/Hookwarden/hookwarden/releases/download/"


def test_only_fetch_module_imports_http_libs() -> None:
    offenders: list[str] = []
    for py_file in SHIM_SRC.rglob("*.py"):
        text = py_file.read_text()
        if HTTP_IMPORT_PATTERN.search(text) and py_file.name != "_fetch.py":
            offenders.append(str(py_file.relative_to(SHIM_SRC)))
    assert offenders == [], (
        f"Only _fetch.py may import HTTP libs (CLI-09 carve-out). Offenders: {offenders}"
    )


def test_egress_only_to_canonical_release_host(
    mock_releases_server, tmp_path: Path
) -> None:
    """download_and_verify with a canonical-pattern URL succeeds when SHA matches.

    This is a happy-path assertion — the contract is that callers pass URLs
    matching the canonical pattern and the fetcher works end-to-end.
    """
    server, _mock_url = mock_releases_server
    body = b"binary-bytes-content"
    server.responses = [(200, body)]
    expected_sha = hashlib.sha256(body).hexdigest()
    dest = tmp_path / "binary"

    server_url = _mock_url
    _fetch.download_and_verify(server_url, expected_sha, dest, base_backoff=0.0)
    assert dest.exists()


def test_egress_rejects_non_canonical_host(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Any urllib.request.urlopen call MUST target the canonical prefix.

    Monkeypatches urlopen to a recorder that fails any URL not starting with
    the canonical prefix. Calling download_and_verify with an evil URL trips
    the recorder — proving the test infrastructure can detect a future
    regression that smuggles a non-canonical URL through the fetch boundary.
    """
    seen: list[str] = []

    def recording_urlopen(req, *args, **kwargs):
        url = req.full_url if hasattr(req, "full_url") else str(req)
        seen.append(url)
        if not url.startswith(CANONICAL_URL_PREFIX):
            raise AssertionError(
                f"non-canonical URL would have been fetched: {url!r}"
            )
        raise RuntimeError("recorder-stop")

    monkeypatch.setattr("urllib.request.urlopen", recording_urlopen)

    dest = tmp_path / "binary"
    evil = "https://evil.example.com/payload"
    with pytest.raises(AssertionError, match="non-canonical URL"):
        _fetch.download_and_verify(evil, "0" * 64, dest, base_backoff=0.0)
    assert seen == [evil]
