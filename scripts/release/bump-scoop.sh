#!/usr/bin/env bash
# scripts/release/bump-scoop.sh
#
# Bumps the Hookwarden/scoop-bucket manifest to a newly published release.
# Invoked by Plan 06's release.yml fan-out step.
#
# Inputs (env):
#   VERSION    Release tag with leading v (e.g. v1.2.3)
#   GH_TOKEN   GitHub App installation token scoped to Hookwarden/scoop-bucket
#
# Output:
#   stdout — the commit SHA pushed to scoop-bucket (consumed by Plan 07's
#            parity gate to pin its raw.githubusercontent.com fetches).

set -euo pipefail

: "${VERSION:?VERSION required (e.g. v1.2.3)}"
: "${GH_TOKEN:?GH_TOKEN required (GitHub App installation token)}"

VER_NO_V="${VERSION#v}"
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

# 1. Pull canonical checksums.txt from the GitHub Release
gh release download "$VERSION" \
  --repo Hookwarden/hookwarden \
  --pattern checksums.txt \
  --output "$WORKDIR/checksums.txt"

# 2. Extract Windows x64 SHA
SHA_WIN_X64=$(awk '$2 == "hookwarden-windows-x64.exe" { print $1; exit }' "$WORKDIR/checksums.txt")
if [[ ! "$SHA_WIN_X64" =~ ^[a-f0-9]{64}$ ]]; then
  echo "ERROR: missing or malformed SHA for hookwarden-windows-x64.exe — checksums.txt content:" >&2
  cat "$WORKDIR/checksums.txt" >&2
  exit 1
fi

# 3. Clone bucket using GitHub App token
git clone "https://x-access-token:${GH_TOKEN}@github.com/Hookwarden/scoop-bucket.git" "$WORKDIR/bucket"
cd "$WORKDIR/bucket"

# 4. In-place edit bucket/hookwarden.json via jq
MANIFEST=bucket/hookwarden.json
NEW_URL="https://github.com/Hookwarden/hookwarden/releases/download/${VERSION}/hookwarden-windows-x64.exe#/hookwarden.exe"

jq --arg ver "$VER_NO_V" --arg url "$NEW_URL" --arg hash "$SHA_WIN_X64" '
  .version = $ver
  | .architecture."64bit".url = $url
  | .architecture."64bit".hash = $hash
' "$MANIFEST" > "$MANIFEST.tmp"
mv "$MANIFEST.tmp" "$MANIFEST"

# Sanity: re-parse to confirm valid JSON
jq empty "$MANIFEST"

# 5. Commit + push
git config user.email "release-bot@hookwarden.dev"
git config user.name  "hookwarden-release-bot"
git add "$MANIFEST"
# -q on commit+push: same $GITHUB_OUTPUT pristine-stdout invariant as
# bump-homebrew.sh (issue #12 bug 9).
git commit -q -m "chore: bump hookwarden to ${VERSION}"
git push -q origin main

# Emit pushed commit SHA
git rev-parse HEAD
