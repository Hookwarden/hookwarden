#!/usr/bin/env bash
# scripts/release/bump-homebrew-edit.sh
# Pure formula-edit core for bump-homebrew.sh. Takes already-fetched
# inputs (checksums.txt + formula path + version + npm-tarball sha) and
# edits the formula in place. No network, no git — testable with fixtures.
#
# Args:
#   $1  CHECKSUMS  path to a v* release's checksums.txt
#   $2  FORMULA    path to Formula/hookwarden.rb (mutated in place)
#   $3  VERSION    release tag with leading v (e.g. v1.2.3)
#   $4  SHA_NPM    sha256 of the npm tarball published as hookwarden@<version>.
#                  The bump-homebrew.sh wrapper downloads the tarball and
#                  computes this before invoking us. Synthetic in tests.
#
# Couples to the formula shape (macOS via npm-wrapper + Linux binaries):
#   - 3 sha256 lines in source order: top-level npm tarball, on_linux/on_arm,
#     on_linux/on_intel
#   - Two URL version patterns: GH `releases/download/vX.Y.Z` for Linux binaries
#     and npm `hookwarden-X.Y.Z.tgz` for the macOS path
#   - No explicit `version "X.Y.Z"` line: the npm tarball URL auto-derives the
#     version correctly (auto-derive only failed on the old linux-arm64 binary
#     URL because of "64" trailing "arm64").
#
# Exits non-zero on missing/malformed Linux SHAs or wrong sha256 count.

set -euo pipefail

CHECKSUMS=${1:?CHECKSUMS path required}
FORMULA=${2:?FORMULA path required}
VERSION=${3:?VERSION required (e.g. v1.2.3)}
SHA_NPM=${4:?SHA_NPM required (sha256 of the npm tarball)}

extract_sha() {
  awk -v f="$1" '$2 == f { print $1; exit }' "$CHECKSUMS"
}

SHA_LINUX_ARM=$(extract_sha hookwarden-linux-arm64)
SHA_LINUX_X64=$(extract_sha hookwarden-linux-x64)

for sha in "$SHA_NPM" "$SHA_LINUX_ARM" "$SHA_LINUX_X64"; do
  if [[ ! "$sha" =~ ^[a-f0-9]{64}$ ]]; then
    echo "ERROR: missing or malformed SHA — checksums.txt + SHA_NPM:" >&2
    cat "$CHECKSUMS" >&2
    echo "SHA_NPM=$SHA_NPM" >&2
    exit 1
  fi
done

# Strip leading 'v' for the npm-tarball URL (which uses bare 0.4.0 not v0.4.0).
VERSION_NUM="${VERSION#v}"

# 1. Bump the Linux GH-release URL version.
sed -i.bak -E "s|(releases/download/)v[0-9]+\.[0-9]+\.[0-9]+|\\1${VERSION}|g" "$FORMULA"
# 2. Bump the npm-tarball URL version.
sed -i.bak -E "s|(registry\.npmjs\.org/hookwarden/-/hookwarden-)[0-9]+\.[0-9]+\.[0-9]+(\.tgz)|\\1${VERSION_NUM}\\2|g" "$FORMULA"

python3 - "$FORMULA" "$SHA_NPM" "$SHA_LINUX_ARM" "$SHA_LINUX_X64" <<'PY'
import re
import sys

path, sha_npm, sha_arm, sha_x64 = sys.argv[1:]
src = open(path).read()

# Pin the three sha256 lines in source order: npm tarball (top-level), then
# on_linux/on_arm (linux-arm64), then on_linux/on_intel (linux-x64).
pattern = re.compile(r'sha256 "[a-f0-9]{64}"')
matches = list(pattern.finditer(src))
assert len(matches) == 3, f"expected 3 sha256 lines, found {len(matches)}"
shas = [sha_npm, sha_arm, sha_x64]
for i in range(2, -1, -1):
    m = matches[i]
    src = src[: m.start()] + f'sha256 "{shas[i]}"' + src[m.end():]

open(path, "w").write(src)
PY

rm -f "${FORMULA}.bak"
