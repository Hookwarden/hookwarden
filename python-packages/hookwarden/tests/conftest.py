"""Shared fixtures for hookwarden shim tests."""
from __future__ import annotations

import http.server
import threading
from pathlib import Path

import pytest


class _MockGitHubReleases(http.server.BaseHTTPRequestHandler):
    """Serves a configurable response sequence.

    The test sets server.responses = [(status, body_bytes), ...] in order.
    """

    def do_GET(self):  # noqa: N802 — stdlib name
        status, body = self.server.responses.pop(0)
        self.send_response(status)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


@pytest.fixture
def mock_releases_server():
    server = http.server.HTTPServer(("127.0.0.1", 0), _MockGitHubReleases)
    server.responses = []  # type: ignore[attr-defined]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    try:
        yield server, f"http://{host}:{port}/binary"
    finally:
        server.shutdown()


@pytest.fixture
def tmp_cache_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Force platformdirs to resolve cache to tmp_path on Linux/macOS via XDG_CACHE_HOME."""
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path))
    return tmp_path
