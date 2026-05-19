#!/usr/bin/env bash
# scripts/release/wait-for-gh-release.sh
# Polls until a named GH Release exists on $GITHUB_REPOSITORY, or times out.
# Extracted from release-py.yml's inline wait gate (bug 2 fix, commit 7d2de0a)
# so the polling logic is testable in isolation.
#
# Inputs (env):
#   TAG                 release tag (e.g. v1.2.3)
#   GITHUB_REPOSITORY   owner/repo (e.g. Hookwarden/hookwarden)
#   GH_TOKEN            auth for `gh release view`
#
# Inputs (env, optional — tuning):
#   MAX_ATTEMPTS        poll count (default 60)
#   SLEEP_SECONDS       seconds between polls (default 30)
#
# Inputs (env, optional — testing):
#   MOCK_RELEASE_PRESENT_AFTER  pretend the release appears after N polls
#                               (bypasses `gh release view`). Set to 0 for
#                               always-present, 1 for first-poll, etc.
#
# Exit codes:
#   0 — release exists (real or mocked)
#   1 — timed out

set -euo pipefail

: "${TAG:?TAG required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY required}"

MAX_ATTEMPTS="${MAX_ATTEMPTS:-60}"
SLEEP_SECONDS="${SLEEP_SECONDS:-30}"

echo "Polling for GH Release '$TAG' (max $((MAX_ATTEMPTS * SLEEP_SECONDS))s)..."

for ((i = 1; i <= MAX_ATTEMPTS; i++)); do
  if [[ -n "${MOCK_RELEASE_PRESENT_AFTER:-}" ]]; then
    if (( i >= MOCK_RELEASE_PRESENT_AFTER )); then
      echo "GH Release '$TAG' is ready after $((i * SLEEP_SECONDS))s. [MOCKED]"
      exit 0
    fi
  else
    if gh release view "$TAG" --repo "$GITHUB_REPOSITORY" --json name -q .name >/dev/null 2>&1; then
      echo "GH Release '$TAG' is ready after $((i * SLEEP_SECONDS))s."
      exit 0
    fi
  fi
  sleep "$SLEEP_SECONDS"
done

echo "ERROR: GH Release '$TAG' did not appear within $((MAX_ATTEMPTS * SLEEP_SECONDS))s — release-binaries.yml failed or is stalled." >&2
exit 1
