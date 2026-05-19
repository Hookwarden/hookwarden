#!/usr/bin/env bash
# scripts/release/bump-hookwarden-action.sh
#
# Bumps the Hookwarden/hookwarden-action distribution repo to a newly published
# release. Invoked by Plan 05-05's release.yml fan-out step (D-78/D-79).
#
# Inputs (env):
#   VERSION    Release tag with leading v (e.g. v1.2.3)
#   GH_TOKEN   GitHub App installation token scoped to Hookwarden/hookwarden-action
#
# Output:
#   stdout — the commit SHA pushed to hookwarden-action (consumed by release.yml's
#            bump-action step output and any future parity gate).
#
# T-05-05-05 mitigation: never `set -x` (would echo GH_TOKEN). The token only
# appears in the git clone URL (handled by git, not echoed).

set -euo pipefail

: "${VERSION:?VERSION required (e.g. v1.2.3)}"
: "${GH_TOKEN:?GH_TOKEN required (GitHub App installation token)}"

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

# 1. Clone hookwarden-action using GitHub App token (https-with-token URL)
git clone "https://x-access-token:${GH_TOKEN}@github.com/Hookwarden/hookwarden-action.git" "$WORKDIR/action"

# 2. Sync bundled dist/ + manifest + README + LICENSE from this monorepo's package.
#    rsync --delete keeps the distribution repo a faithful mirror of the package
#    layout — no leftover files from older bundle shapes.
rsync -a --delete packages/github-action/dist/ "$WORKDIR/action/dist/"
cp packages/github-action/action.yml "$WORKDIR/action/action.yml"
cp packages/github-action/README.md  "$WORKDIR/action/README.md"
cp packages/github-action/LICENSE    "$WORKDIR/action/LICENSE"

cd "$WORKDIR/action"

# 3. Identity matches bump-homebrew.sh + bump-scoop.sh (T-05-05-04)
git config user.email "release-bot@hookwarden.dev"
git config user.name  "hookwarden-release-bot"

git add -A
# -q + redirect: keep stdout pristine so only `git rev-parse HEAD` below
# reaches the caller (same $GITHUB_OUTPUT invariant as the other bump
# scripts — issue #12 bug 9).
git commit -q -m "chore: release ${VERSION}"

# 4. Tags: moving v1 (force-pushed each release per D-79; standard Action convention)
#    plus immutable per-release vX.Y.Z (users wanting reproducibility pin to it)
git tag -f v1
git tag "${VERSION}"

git push -q origin main --force
git push -q origin --tags --force

# 5. Emit pushed commit SHA to stdout for release.yml's `action-sha` output
git rev-parse HEAD
