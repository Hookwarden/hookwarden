"""HTTP download with bounded retry + streaming SHA-256 verify.

This is the ONLY module in the shim permitted to import HTTP libraries
(CLI-09 carve-out — enforced by tests/test_egress.py). On SHA mismatch the
download is rejected immediately with no retry — tampering is terminal,
not transient (DC-04).
"""
from __future__ import annotations

from pathlib import Path


class IntegrityError(Exception):
    """Raised when a downloaded binary's SHA-256 does not match the pinned value (DC-04)."""


def download_and_verify(
    url: str,
    expected_sha: str,
    dest: Path,
    max_retries: int = 3,
    base_backoff: float = 1.0,
) -> None:
    """GET url, stream to a tempfile while computing SHA-256.

    On 5xx or socket.error: exponential backoff retry up to max_retries.
    On 4xx: raise immediately.
    On SHA mismatch: delete tempfile, raise IntegrityError (DC-04 — never retry).
    On success: atomic_write(dest, ...). Sets exec bit on POSIX (chmod 0o755).
    """
    raise NotImplementedError("Plan 04.1-01 Task 2")
