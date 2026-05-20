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
#   - Explicit `version "X.Y.Z"` line: auto-derive picks up "64" from the
#     trailing "arm64" in the binary filename instead of the path version.
#     The script inserts or updates this line on every bump.
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

# Strip leading 'v' for the version string written into the formula.
VERSION_NUM="${VERSION#v}"

python3 - "$FORMULA" "$SHA_LINUX_ARM" "$SHA_LINUX_X64" "$VERSION_NUM" <<'PY'
import re
import sys

path, sha_arm, sha_x64, version_num = sys.argv[1:]
src = open(path).read()

# 1. Pin the two sha256 lines (top-level arm, on_intel x64) in order.
pattern = re.compile(r'sha256 "[a-f0-9]{64}"')
matches = list(pattern.finditer(src))
assert len(matches) == 2, f"expected 2 sha256 lines, found {len(matches)}"
shas = [sha_arm, sha_x64]
for i in range(1, -1, -1):
    m = matches[i]
    src = src[: m.start()] + f'sha256 "{shas[i]}"' + src[m.end():]

# 2. Insert or update the explicit `version "X.Y.Z"` line. Homebrew's
#    Version.detect picks up "64" from the trailing "arm64" in the URL
#    instead of the path version — must be pinned explicitly.
version_line = f'  version "{version_num}"'
if re.search(r'^\s*version\s+"[^"]+"', src, re.MULTILINE):
    src = re.sub(r'^\s*version\s+"[^"]+"', version_line, src, count=1, flags=re.MULTILINE)
else:
    # Insert immediately BEFORE the top-level (first) sha256 line.
    # brew audit enforces DSL order: url -> version -> sha256.
    src = re.sub(
        r'(^  sha256 "[a-f0-9]{64}"\n)',
        f'{version_line}\n\\1',
        src,
        count=1,
        flags=re.MULTILINE,
    )

open(path, "w").write(src)
PY

rm -f "${FORMULA}.bak"
