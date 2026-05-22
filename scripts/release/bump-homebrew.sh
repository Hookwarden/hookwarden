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

# 2. Clone tap using GitHub App token (https-with-token URL)
git clone "https://x-access-token:${GH_TOKEN}@github.com/Hookwarden/homebrew-tap.git" "$WORKDIR/tap"

# 3. Download the npm tarball for this release and compute its sha256.
#    The macOS path of the formula installs from this tarball, so the SHA
#    must be pinned alongside the Linux binary SHAs. Tarballs are immutable
#    once published, so this SHA is stable for a given version.
NPM_TARBALL_URL="https://registry.npmjs.org/hookwarden/-/hookwarden-${VER_NO_V}.tgz"
curl -fsSL "$NPM_TARBALL_URL" -o "$WORKDIR/hookwarden.tgz"
SHA_NPM=$(sha256sum "$WORKDIR/hookwarden.tgz" | awk '{print $1}')

# 4. In-place edit Formula/hookwarden.rb — delegates to the testable edit core
FORMULA=Formula/hookwarden.rb
bash "$(dirname "$0")/bump-homebrew-edit.sh" \
  "$WORKDIR/checksums.txt" \
  "$WORKDIR/tap/$FORMULA" \
  "$VERSION" \
  "$SHA_NPM"

cd "$WORKDIR/tap"

# 5. Commit + push
git config user.email "release-bot@hookwarden.dev"
git config user.name  "hookwarden-release-bot"
git add "$FORMULA"
# -q on commit+push: keeps stdout pristine so only `git rev-parse HEAD`
# below reaches the caller (release.yml captures this as a step output;
# any extra lines fail $GITHUB_OUTPUT parsing — see issue #12 bug 9).
git commit -q -m "chore: bump hookwarden to ${VERSION}"
git push -q origin main

# Emit pushed commit SHA to stdout for Plan 07's parity gate
git rev-parse HEAD
