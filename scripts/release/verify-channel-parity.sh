#!/usr/bin/env bash
# scripts/release/verify-channel-parity.sh
# Channel-parity SHA gate. Reads canonical SHAs from the GitHub Release's
# checksums.txt and verifies that PyPI shim's pinned data, Homebrew formula,
# and Scoop manifest all reference matching SHAs.
#
# This wrapper handles network fetches (gh release download, pip download,
# curl raw.githubusercontent.com pinned to commit SHAs) and delegates the
# pure comparison to verify-channel-parity-core.sh.
#
# Inputs (env):
#   VERSION         — release tag with leading v (e.g. v1.2.3)
#   HOMEBREW_SHA    — commit SHA just pushed to Hookwarden/homebrew-tap by Plan 03's bump script
#   SCOOP_SHA       — commit SHA just pushed to Hookwarden/scoop-bucket by Plan 04's bump script
#   GH_TOKEN        — GitHub token with read access to Hookwarden/hookwarden
#
# Exit codes:
#   0 — all channels match canonical
#   1 — at least one channel diverges (release marked failed)

set -euo pipefail

: "${VERSION:?VERSION required (e.g. v1.2.3)}"
: "${HOMEBREW_SHA:?HOMEBREW_SHA required (just-pushed commit on homebrew-tap)}"
: "${SCOOP_SHA:?SCOOP_SHA required (just-pushed commit on scoop-bucket)}"
: "${GH_TOKEN:?GH_TOKEN required}"

VER_NO_V="${VERSION#v}"
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

echo "===> Channel-parity SHA gate for ${VERSION}"
echo "     Homebrew tap pinned to ${HOMEBREW_SHA}"
echo "     Scoop bucket pinned to ${SCOOP_SHA}"

# 1. Canonical SHAs from the GitHub Release's checksums.txt
gh release download "$VERSION" \
  --repo Hookwarden/hookwarden \
  --pattern checksums.txt \
  --output "$WORKDIR/checksums.txt"

# 2. PyPI shim wheel — extract _data/checksums.json
WHEEL_DIR="$WORKDIR/wheel"
mkdir -p "$WHEEL_DIR"
pip download "hookwarden==${VER_NO_V}" --no-deps --dest "$WHEEL_DIR" --quiet
WHEEL=$(ls "$WHEEL_DIR"/hookwarden-*.whl 2>/dev/null | head -1)
if [[ -z "$WHEEL" ]]; then
  echo "FAIL: PyPI shim wheel not found at hookwarden==${VER_NO_V}" >&2
  exit 1
fi
unzip -p "$WHEEL" "hookwarden/_data/checksums.json" > "$WORKDIR/shim-checksums.json"

# 3. Homebrew formula — pinned to just-pushed commit (no HEAD-of-main race)
HOMEBREW_RAW="https://raw.githubusercontent.com/Hookwarden/homebrew-tap/${HOMEBREW_SHA}/Formula/hookwarden.rb"
curl -fsSL "$HOMEBREW_RAW" > "$WORKDIR/hookwarden.rb"

# 4. Scoop manifest — pinned to just-pushed commit
SCOOP_RAW="https://raw.githubusercontent.com/Hookwarden/scoop-bucket/${SCOOP_SHA}/bucket/hookwarden.json"
curl -fsSL "$SCOOP_RAW" > "$WORKDIR/hookwarden.json"

# 5. Delegate the comparison
if bash "$(dirname "$0")/verify-channel-parity-core.sh" \
     "$WORKDIR/checksums.txt" \
     "$WORKDIR/shim-checksums.json" \
     "$WORKDIR/hookwarden.rb" \
     "$WORKDIR/hookwarden.json"; then
  echo
  echo "===> CHANNEL-PARITY GATE PASSED — all channels reference matching SHAs."
  exit 0
fi

echo
echo "===> CHANNEL-PARITY GATE FAILED"
echo
echo "Recovery (manual; v1 has no auto-rollback per CONTEXT §Out of scope):"
echo "  - homebrew-tap: git revert HEAD on Hookwarden/homebrew-tap (commit ${HOMEBREW_SHA})"
echo "  - scoop-bucket: git revert HEAD on Hookwarden/scoop-bucket (commit ${SCOOP_SHA})"
echo "  - PyPI:         pip yank hookwarden==${VER_NO_V} via the PyPI web UI"
echo "  - GitHub Release tag (${VERSION}): DO NOT DELETE — would break downstream users who already pulled"
exit 1
