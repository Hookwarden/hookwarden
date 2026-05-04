"""Target detection, URL templating, and pinned-SHA lookup.

Implements the binary-resolution surface for the shim. Pure logic — no I/O
beyond reading the in-package `_data/checksums.json` (which is package data,
not network access — see CLI-09 carve-out enforced by tests/test_egress.py).
"""
from __future__ import annotations

import json
import platform
from pathlib import Path

_SYSTEM_MAP = {"Darwin": "darwin", "Linux": "linux", "Windows": "windows"}
_ARCH_MAP = {
    "arm64": "arm64",
    "aarch64": "arm64",
    "x86_64": "x64",
    "AMD64": "x64",
}

_CHECKSUMS_PATH = Path(__file__).parent / "_data" / "checksums.json"


def detect_target() -> tuple[str, str]:
    sys_name = _SYSTEM_MAP.get(platform.system())
    if sys_name is None:
        raise RuntimeError(f"hookwarden: unsupported OS {platform.system()!r}")
    arch = _ARCH_MAP.get(platform.machine())
    if arch is None:
        raise RuntimeError(
            f"hookwarden: unsupported architecture {platform.machine()!r}"
        )
    return sys_name, arch


def pinned_sha(target: tuple[str, str]) -> str:
    key = f"{target[0]}-{target[1]}"
    data = json.loads(_CHECKSUMS_PATH.read_text())
    if key not in data:
        raise KeyError(
            f"hookwarden: no SHA-256 pinned for target {key!r} in checksums.json"
        )
    return data[key]


def release_url(target: tuple[str, str], version: str) -> str:
    os_, arch = target
    suffix = ".exe" if os_ == "windows" else ""
    return (
        f"https://github.com/Hookwarden/hookwarden/releases/download/"
        f"v{version}/hookwarden-{os_}-{arch}{suffix}"
    )


def exec_name(target: tuple[str, str]) -> str:
    return "hookwarden.exe" if target[0] == "windows" else "hookwarden"
