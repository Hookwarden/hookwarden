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
#   - Explicit `version "X.Y.Z"` line REQUIRED below the top-level url. Brew's
#     URL-version auto-derive picks "64" from the Linux on_arm/on_intel URLs
#     (`hookwarden-linux-arm64` / `hookwarden-linux-x64`) on Linux runners,
#     even when the top-level npm-tarball URL is correct. The DIST-02 smoke
#     gate compares `brew info versions.stable` to `hookwarden --version` and
#     trips on this mismatch. The script ensures the line is present and
#     reflects the bumped version.
#
# Exits non-zero on missing/malformed Linux SHAs or wrong sha256 count.

set -euo pipefail

CHECKSUMS=${1:?CHECKSUMS path required}
FORMULA=${2:?FORMULA path required}
VERSION=${3:?VERSION required (e.g. v1.2.3)}
SHA_NPM=${4:?SHA_NPM required (sha256 of the npm tarball)}

# Explicit input-file checks: clearer failure mode than awk's "can't open" when
# the path is wrong (a real concern for CI runners with surprising cwd state).
if [[ ! -f "$CHECKSUMS" ]]; then
  echo "ERROR: CHECKSUMS file does not exist: $CHECKSUMS" >&2
  exit 1
fi
if [[ ! -f "$FORMULA" ]]; then
  echo "ERROR: FORMULA file does not exist: $FORMULA" >&2
  exit 1
fi

# Validate VERSION shape: must start with 'v' and parse as semver-ish
# (allows pre-release suffixes like -rc.1, -beta.2). The release workflow's
# tag-push trigger already gates this upstream, but a clearer local error
# beats a confusing "sed produced no changes" downstream.
if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "ERROR: VERSION must match 'v<major>.<minor>.<patch>[-prerelease]' — got '$VERSION'" >&2
  exit 1
fi

extract_sha() {
  # tr -d '\r' strips DOS line endings before awk match. Windows-touched
  # checksums.txt (rare but real on cross-platform CI) would otherwise fail
  # `$2 == filename` because the trailing \r becomes part of $2.
  tr -d '\r' < "$CHECKSUMS" | awk -v f="$1" '$2 == f { print $1; exit }'
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

python3 - "$FORMULA" "$VERSION_NUM" "$SHA_NPM" "$SHA_LINUX_ARM" "$SHA_LINUX_X64" <<'PY'
import re
import sys

path, version_num, sha_npm, sha_arm, sha_x64 = sys.argv[1:]
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

# Ensure an explicit top-level `version "X.Y.Z"` line is present, sitting
# between the top-level `url` and `sha256`. brew audit requires the order
# url → version → sha256 (homebrew-tap commit f927ca6); the Linux URL
# overrides confuse URL-version auto-derive into picking "64". This block
# either updates an existing line in place or inserts a new one right
# after the top-level npm-tarball URL.
version_re = re.compile(r'^(\s*)version\s+"[^"]+"', re.MULTILINE)
if version_re.search(src):
    src = version_re.sub(rf'\1version "{version_num}"', src, count=1)
else:
    url_re = re.compile(
        r'^(\s*)url\s+"https://registry\.npmjs\.org/hookwarden/-/hookwarden-[^"]+"\n',
        re.MULTILINE,
    )
    m = url_re.search(src)
    assert m, "could not locate top-level npm-tarball url line for version insert"
    indent = m.group(1)
    insert = f'{indent}version "{version_num}"\n'
    src = src[: m.end()] + insert + src[m.end():]

open(path, "w").write(src)
PY

rm -f "${FORMULA}.bak"
