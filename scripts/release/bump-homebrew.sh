#!/usr/bin/env bash
# scripts/release/bump-homebrew.sh
#
# Bumps the Hookwarden/homebrew-tap formula to a newly published release.
# Invoked by Plan 06's release.yml fan-out step.
#
# Inputs (env):
#   VERSION    Release tag with leading v (e.g. v1.2.3)
#   GH_TOKEN   GitHub App installation token scoped to Hookwarden/homebrew-tap
#
# Output:
#   stdout — the commit SHA pushed to homebrew-tap (consumed by Plan 07's
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

extract_sha() {
  local filename=$1
  awk -v f="$filename" '$2 == f { print $1; exit }' "$WORKDIR/checksums.txt"
}
SHA_DARWIN_ARM=$(extract_sha hookwarden-darwin-arm64)
SHA_DARWIN_X64=$(extract_sha hookwarden-darwin-x64)
SHA_LINUX_ARM=$(extract_sha hookwarden-linux-arm64)
SHA_LINUX_X64=$(extract_sha hookwarden-linux-x64)
for sha in "$SHA_DARWIN_ARM" "$SHA_DARWIN_X64" "$SHA_LINUX_ARM" "$SHA_LINUX_X64"; do
  if [[ ! "$sha" =~ ^[a-f0-9]{64}$ ]]; then
    echo "ERROR: missing or malformed SHA for one of the targets — checksums.txt content:" >&2
    cat "$WORKDIR/checksums.txt" >&2
    exit 1
  fi
done

# 2. Clone tap using GitHub App token (https-with-token URL)
git clone "https://x-access-token:${GH_TOKEN}@github.com/Hookwarden/homebrew-tap.git" "$WORKDIR/tap"
cd "$WORKDIR/tap"

# 3. In-place edit Formula/hookwarden.rb
FORMULA=Formula/hookwarden.rb

# Bump version line
sed -i.bak -E "s|^  version \"[^\"]+\"|  version \"${VER_NO_V}\"|" "$FORMULA"

# Replace the four sha256 lines IN ORDER (darwin-arm, darwin-x64, linux-arm, linux-x64).
# We rely on the formula's deterministic block ordering.
python3 - "$FORMULA" "$SHA_DARWIN_ARM" "$SHA_DARWIN_X64" "$SHA_LINUX_ARM" "$SHA_LINUX_X64" <<'PY'
import re
import sys

path, *shas = sys.argv[1:]
src = open(path).read()
pattern = re.compile(r'sha256 "[a-f0-9]{64}"')
matches = list(pattern.finditer(src))
assert len(matches) == 4, f"expected 4 sha256 lines, found {len(matches)}"
# Replace in reverse order so earlier offsets remain valid.
for i in range(3, -1, -1):
    m = matches[i]
    src = src[: m.start()] + f'sha256 "{shas[i]}"' + src[m.end() :]
open(path, "w").write(src)
PY

rm -f "${FORMULA}.bak"

# 4. Commit + push
git config user.email "release-bot@hookwarden.dev"
git config user.name  "hookwarden-release-bot"
git add "$FORMULA"
git commit -m "chore: bump hookwarden to ${VERSION}"
git push origin main

# Emit pushed commit SHA to stdout for Plan 07's parity gate
git rev-parse HEAD
