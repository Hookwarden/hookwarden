#!/usr/bin/env python3
"""Stamp pinned per-target SHA-256 checksums into the PyPI shim's package data.

Run during release-py.yml AFTER the GitHub Release is published (with binaries +
checksums.txt uploaded by Phase 4.x) but BEFORE `python -m build`.

Usage: python scripts/release/stamp-checksums.py v1.2.3
Env:   GH_TOKEN — required for `gh release download`
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

REPO = "Hookwarden/hookwarden"
SHIM_DATA = Path("python-packages/hookwarden/src/hookwarden/_data/checksums.json")

FILENAME_TO_KEY = {
    "hookwarden-darwin-arm64": "darwin-arm64",
    "hookwarden-darwin-x64":   "darwin-x64",
    "hookwarden-linux-arm64":  "linux-arm64",
    "hookwarden-linux-x64":    "linux-x64",
    "hookwarden-windows-x64.exe": "windows-x64",
}

# Targets required to ship the release. macOS (darwin-arm64, darwin-x64)
# is excluded from v0.3.x because Apple Developer Program enrollment is
# unfunded; Plan 04.2-04 is deferred-in-place. Restore the two darwin
# entries when funding lands and the macOS build matrix re-activates in
# release-binaries.yml.
REQUIRED_TARGETS = frozenset({"linux-arm64", "linux-x64", "windows-x64"})

SHA_RE = re.compile(r"^([a-f0-9]{64})\s+(\S+)$", re.M)


def main(version: str) -> int:
    if not version.startswith("v"):
        sys.stderr.write(f"ERROR: VERSION must start with 'v', got: {version}\n")
        return 1

    workdir = Path(os.environ.get("RUNNER_TEMP", "/tmp")) / "stamp-checksums"
    workdir.mkdir(parents=True, exist_ok=True)
    checksums_path = workdir / "checksums.txt"

    subprocess.run(
        [
            "gh", "release", "download", version,
            "--repo", REPO,
            "--pattern", "checksums.txt",
            "--output", str(checksums_path),
        ],
        check=True,
    )

    raw = checksums_path.read_text()
    matches = SHA_RE.findall(raw)
    if not matches:
        sys.stderr.write(f"ERROR: no sha256-format lines found in checksums.txt:\n{raw}\n")
        return 1

    pinned: dict[str, str] = {}
    for sha, filename in matches:
        if filename in FILENAME_TO_KEY:
            pinned[FILENAME_TO_KEY[filename]] = sha
        else:
            sys.stderr.write(f"INFO: ignoring unrecognized artifact {filename}\n")

    actual = set(pinned.keys())
    missing = REQUIRED_TARGETS - actual
    if missing:
        sys.stderr.write(f"ERROR: missing pins for targets: {sorted(missing)}\n")
        sys.stderr.write(f"checksums.txt content:\n{raw}\n")
        return 1

    SHIM_DATA.parent.mkdir(parents=True, exist_ok=True)
    SHIM_DATA.write_text(json.dumps(pinned, indent=2, sort_keys=True) + "\n")
    print(f"Stamped {len(pinned)} pins into {SHIM_DATA}")
    print(json.dumps(pinned, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.stderr.write("usage: stamp-checksums.py <VERSION-with-leading-v>\n")
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
