#!/usr/bin/env bash
# scripts/release/bump-homebrew-edit.sh
# Pure formula-edit core for bump-homebrew.sh. Takes already-fetched
# inputs (checksums.txt + formula path + version) and edits the formula
# in place. No network, no git — testable with fixtures.
#
# Args:
#   $1  CHECKSUMS  path to a v* release's checksums.txt
#   $2  FORMULA    path to Formula/hookwarden.rb (mutated in place)
#   $3  VERSION    release tag with leading v (e.g. v1.2.3)
#
# Couples to the formula shape (Linux-only, see Hookwarden/homebrew-tap):
#   - 2 sha256 lines (top-level linux-arm64, on_intel linux-x64)
#   - URL version embedded in `releases/download/vX.Y.Z` paths
#   - No explicit `version` line — auto-derives from top-level url
#
# Exits non-zero on missing/malformed Linux SHAs or wrong sha256 count.

set -euo pipefail

CHECKSUMS=${1:?CHECKSUMS path required}
FORMULA=${2:?FORMULA path required}
VERSION=${3:?VERSION required (e.g. v1.2.3)}

extract_sha() {
  awk -v f="$1" '$2 == f { print $1; exit }' "$CHECKSUMS"
}

SHA_LINUX_ARM=$(extract_sha hookwarden-linux-arm64)
SHA_LINUX_X64=$(extract_sha hookwarden-linux-x64)

for sha in "$SHA_LINUX_ARM" "$SHA_LINUX_X64"; do
  if [[ ! "$sha" =~ ^[a-f0-9]{64}$ ]]; then
    echo "ERROR: missing or malformed SHA for one of the Linux targets — checksums.txt content:" >&2
    cat "$CHECKSUMS" >&2
    exit 1
  fi
done

sed -i.bak -E "s|(releases/download/)v[0-9]+\.[0-9]+\.[0-9]+|\\1${VERSION}|g" "$FORMULA"

python3 - "$FORMULA" "$SHA_LINUX_ARM" "$SHA_LINUX_X64" <<'PY'
import re
import sys

path, *shas = sys.argv[1:]
src = open(path).read()
pattern = re.compile(r'sha256 "[a-f0-9]{64}"')
matches = list(pattern.finditer(src))
assert len(matches) == 2, f"expected 2 sha256 lines, found {len(matches)}"
for i in range(1, -1, -1):
    m = matches[i]
    src = src[: m.start()] + f'sha256 "{shas[i]}"' + src[m.end() :]
open(path, "w").write(src)
PY

rm -f "${FORMULA}.bak"
