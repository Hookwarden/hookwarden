"""HTTP download with bounded retry + streaming SHA-256 verify.

This is the ONLY module in the shim permitted to import HTTP libraries
(CLI-09 carve-out — enforced by tests/test_egress.py). On SHA mismatch the
download is rejected immediately with no retry — tampering is terminal,
not transient (DC-04).
"""
from __future__ import annotations

import hashlib
import os
import socket
import time
import urllib.error
import urllib.request
from pathlib import Path

from . import __version__, _cache


class IntegrityError(Exception):
    """Raised when a downloaded binary's SHA-256 does not match the pinned value (DC-04)."""


def download_and_verify(
    url: str,
    expected_sha: str,
    dest: Path,
    max_retries: int = 3,
    base_backoff: float = 1.0,
) -> None:
    attempt = 0
    while True:
        attempt += 1
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": f"hookwarden-shim/{__version__}"}
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                h = hashlib.sha256()
                chunks: list[bytes] = []
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    h.update(chunk)
                    chunks.append(chunk)
                actual = h.hexdigest()
                if actual != expected_sha:
                    raise IntegrityError(
                        f"hookwarden: SHA-256 mismatch for {url}.\n"
                        f"  expected: {expected_sha}\n"
                        f"  actual:   {actual}\n"
                        f"  This indicates a tampered download or the wrong "
                        f"target was selected. Refusing to write binary."
                    )
                _cache.atomic_write(dest, iter(chunks))
                if os.name == "posix":
                    os.chmod(dest, 0o755)
                return
        except urllib.error.HTTPError as e:
            if 400 <= e.code < 500:
                raise
            if attempt >= max_retries:
                raise
        except (urllib.error.URLError, socket.error, TimeoutError):
            if attempt >= max_retries:
                raise
        time.sleep(base_backoff * (2 ** (attempt - 1)))
