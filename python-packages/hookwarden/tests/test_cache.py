"""Tests for cache-dir resolution, filelock, atomic write, sha-validation (Plan 04.1-01 §_cache)."""
from __future__ import annotations

import threading
import time
from pathlib import Path

import pytest

from hookwarden import _cache


def test_cache_dir_uses_platformdirs(tmp_cache_root: Path) -> None:
    target = ("linux", "x64")
    resolved = _cache.cache_dir_for(target)
    package_dir = Path(_cache.__file__).parent
    assert "hookwarden" in str(resolved)
    assert package_dir not in resolved.parents, (
        "cache must NOT live next to the package install (Pitfall 1)"
    )


def test_atomic_write_does_not_leave_partial(tmp_path: Path) -> None:
    target = tmp_path / "binary"

    def exploding_iter():
        yield b"hello"
        raise RuntimeError("simulated mid-stream failure")

    with pytest.raises(RuntimeError, match="simulated mid-stream failure"):
        _cache.atomic_write(target, exploding_iter())
    assert not target.exists(), "partial write must not leave target file"


def test_lock_serializes_writers(tmp_path: Path) -> None:
    enter_order: list[str] = []
    exit_order: list[str] = []
    lock_held = threading.Event()
    second_blocked = threading.Event()

    def first_writer():
        with _cache.lock(tmp_path):
            enter_order.append("first")
            lock_held.set()
            second_blocked.wait(timeout=2)
            time.sleep(0.05)
            exit_order.append("first")

    def second_writer():
        lock_held.wait(timeout=2)
        second_blocked.set()
        with _cache.lock(tmp_path):
            enter_order.append("second")
            exit_order.append("second")

    t1 = threading.Thread(target=first_writer)
    t2 = threading.Thread(target=second_writer)
    t1.start()
    t2.start()
    t1.join(timeout=5)
    t2.join(timeout=5)

    assert enter_order == ["first", "second"]
    assert exit_order == ["first", "second"]


def test_is_valid_returns_false_for_wrong_sha(tmp_path: Path) -> None:
    binary = tmp_path / "fake-binary"
    binary.write_bytes(b"contents")
    assert _cache.is_valid(binary, expected_sha="0" * 64) is False


def test_is_valid_returns_true_for_matching_sha(tmp_path: Path) -> None:
    import hashlib

    binary = tmp_path / "fake-binary"
    binary.write_bytes(b"contents")
    sha = hashlib.sha256(b"contents").hexdigest()
    assert _cache.is_valid(binary, expected_sha=sha) is True
