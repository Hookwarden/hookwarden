"""Target detection, URL templating, and pinned-SHA lookup.

Implements the binary-resolution surface for the shim. Pure logic — no I/O
beyond reading the in-package `_data/checksums.json` (which is package data,
not network access — see CLI-09 carve-out enforced by tests/test_egress.py).
"""
from __future__ import annotations


def detect_target() -> tuple[str, str]:
    """Return (os, arch). os ∈ {'darwin', 'linux', 'windows'}; arch ∈ {'arm64', 'x64'}.

    Maps via platform.system() + platform.machine().
    """
    raise NotImplementedError("Plan 04.1-01 Task 2")


def pinned_sha(target: tuple[str, str]) -> str:
    """Return the SHA-256 hex string from _data/checksums.json. Raises KeyError on miss."""
    raise NotImplementedError("Plan 04.1-01 Task 2")


def release_url(target: tuple[str, str], version: str) -> str:
    """Return the canonical GitHub Releases download URL for this target.

    Pattern: 'https://github.com/Hookwarden/hookwarden/releases/download/v{version}/hookwarden-{os}-{arch}{.exe?}'.
    Version comes from importlib.metadata.version('hookwarden').
    """
    raise NotImplementedError("Plan 04.1-01 Task 2")


def exec_name(target: tuple[str, str]) -> str:
    """Return 'hookwarden' or 'hookwarden.exe'."""
    raise NotImplementedError("Plan 04.1-01 Task 2")
