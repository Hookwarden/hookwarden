"""Concurrent-install race resolution via filelock (Plan 04.1-01 §_cache.lock)."""
from __future__ import annotations

import threading
from pathlib import Path

from hookwarden import _cache


def test_two_threads_serialize_via_filelock(tmp_path: Path) -> None:
    """Two threads compete for the cache lock; both must complete without crashing
    and the second must observe the cache populated by the first.
    """
    cache_dir = tmp_path / "bin"
    cache_dir.mkdir()
    binary = cache_dir / "fake"
    write_count = 0
    write_lock = threading.Lock()

    def writer():
        nonlocal write_count
        with _cache.lock(cache_dir):
            if not binary.exists():
                with write_lock:
                    write_count += 1
                _cache.atomic_write(binary, iter([b"hello"]))

    threads = [threading.Thread(target=writer) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=5)

    assert binary.exists()
    assert binary.read_bytes() == b"hello"
    assert write_count == 1, "filelock must prevent double-write"
