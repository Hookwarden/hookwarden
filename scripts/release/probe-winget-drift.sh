#!/usr/bin/env bash
# scripts/release/probe-winget-drift.sh
# Probe whether microsoft/winget-pkgs is behind Hookwarden/hookwarden GitHub Releases.
# If drift > 72h and no open [winget-drift] issue exists, create one.
#
# Inputs (env, REQUIRED):
#   GH_TOKEN — for `gh` CLI
#
# Inputs (env, OPTIONAL — for testing):
#   MOCK_GH_TAG               — substitute for `gh release view ... tagName`
#   MOCK_GH_PUBLISHED_AT      — substitute for `gh release view ... publishedAt` (ISO 8601)
#   MOCK_WINGET_VERSIONS      — substitute for the version directory listing (newline-separated)
#   MOCK_EXISTING_ISSUES_COUNT — substitute for the existing issue search count (integer)
#   DRY_RUN                   — if "1", print the would-be `gh issue create` invocation but don't execute it
#
# Exit codes:
#   0 — probe ran successfully (regardless of drift; a created issue is normal)
#   1 — internal error (gh CLI failure, malformed input, etc.)

set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"

if [[ -n "${MOCK_GH_TAG:-}" ]]; then
  GH_TAG="$MOCK_GH_TAG"
  GH_PUBLISHED_AT="$MOCK_GH_PUBLISHED_AT"
else
  : "${GH_TOKEN:?GH_TOKEN required}"
  RELEASE_JSON=$(gh release list --repo Hookwarden/hookwarden --limit 10 --json tagName,publishedAt,isDraft)
  GH_TAG=$(echo "$RELEASE_JSON" | jq -r 'map(select(.isDraft == false)) | .[0].tagName')
  GH_PUBLISHED_AT=$(echo "$RELEASE_JSON" | jq -r 'map(select(.isDraft == false)) | .[0].publishedAt')
fi

if [[ -z "$GH_TAG" || "$GH_TAG" == "null" ]]; then
  echo "INFO: no published GitHub Release found — nothing to compare against. Exiting."
  exit 0
fi
GH_VER="${GH_TAG#v}"

# Use ${VAR+set} so MOCK_WINGET_VERSIONS="" (set-but-empty) takes the mock path.
# Plain ${VAR:-} would treat empty-set as unset and fall through to the real `gh api` call,
# which is wrong for the "WinGet directory missing" test scenario.
if [[ -n "${MOCK_WINGET_VERSIONS+set}" ]]; then
  WINGET_VERSIONS="$MOCK_WINGET_VERSIONS"
else
  WINGET_VERSIONS=$(gh api repos/microsoft/winget-pkgs/contents/manifests/h/Hookwarden/Hookwarden \
                      --jq '[.[] | select(.type == "dir") | .name] | .[]' 2>/dev/null || echo "")
fi

if [[ -z "$WINGET_VERSIONS" ]]; then
  WINGET_LATEST=""
  echo "INFO: WinGet manifest directory does not exist yet (first submission may not have merged)."
else
  WINGET_LATEST=$(echo "$WINGET_VERSIONS" | sort -V | tail -1)
fi

echo "GitHub Release: ${GH_TAG} (published ${GH_PUBLISHED_AT})"
echo "WinGet latest:  ${WINGET_LATEST:-<none>}"

if [[ "$GH_VER" == "$WINGET_LATEST" ]]; then
  echo "STATUS: in-sync"
  exit 0
fi

NOW_EPOCH=$(date -u +%s)
PUBLISHED_EPOCH=$(date -u -d "$GH_PUBLISHED_AT" +%s 2>/dev/null || \
                  date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$GH_PUBLISHED_AT" +%s)
AGE_SECONDS=$(( NOW_EPOCH - PUBLISHED_EPOCH ))
AGE_HOURS=$(( AGE_SECONDS / 3600 ))

echo "Drift age: ${AGE_HOURS}h"
if (( AGE_HOURS <= 72 )); then
  echo "STATUS: drift within 72h grace — no action"
  exit 0
fi

if [[ -n "${MOCK_EXISTING_ISSUES_COUNT:-}" ]]; then
  EXISTING="$MOCK_EXISTING_ISSUES_COUNT"
else
  EXISTING=$(gh issue list --repo Hookwarden/hookwarden \
               --search '[winget-drift]' \
               --state open \
               --json number --jq 'length')
fi

if (( EXISTING > 0 )); then
  echo "STATUS: drift >${AGE_HOURS}h but open [winget-drift] issue already exists; skipping."
  exit 0
fi

TITLE="[winget-drift] WinGet manifest is ${AGE_HOURS}h behind GitHub Release"
BODY=$(cat <<EOF
GitHub Release: \`${GH_TAG}\` (published ${GH_PUBLISHED_AT}, ${AGE_HOURS}h ago)
WinGet manifest latest: \`${WINGET_LATEST:-<none>}\`

Likely the WinGet PR was rejected, blocked, or did not open. Investigate \`microsoft/winget-pkgs\` PRs from \`hookwarden-bot\`:

  gh pr list --repo microsoft/winget-pkgs --author hookwarden-bot --state all

Recovery: see \`docs/release/winget-bot-setup.md\` §Failure modes.
EOF
)

if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY_RUN: would create issue:"
  echo "  title: $TITLE"
  echo "  body: <see stdout>"
  echo "$BODY"
else
  gh issue create --repo Hookwarden/hookwarden \
    --title "$TITLE" \
    --label "dist/sha-drift" \
    --body "$BODY"
fi

echo "STATUS: drift >${AGE_HOURS}h — issue created"
