#!/usr/bin/env bash
# scripts/release/test-drift-probe.sh
# 5-case synthetic test for probe-winget-drift.sh.
# Mocks all GitHub API responses via MOCK_* env vars; uses DRY_RUN to capture intent.
#
# W5 FIX RATIONALE: implemented as plain bash + MOCK_* env vars + `set -euo pipefail`
# (NOT bats). Matches Plans 03/04/06/07 conventions and avoids adding bats as a CI install.
# Test isolation comes from the probe script's MOCK_* contract — every external boundary
# (gh API, gh CLI, date) is mockable, so the test needs no subprocess-isolation framework.

set -euo pipefail

cd "$(dirname "$0")/../.."
PROBE=scripts/release/probe-winget-drift.sh

ago_hours() {
  local hours=$1
  if date -u -d "${hours} hours ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null; then
    return
  fi
  date -u -v-${hours}H +%Y-%m-%dT%H:%M:%SZ
}

# ---- Test 1: in-sync ----
echo "Test 1: in-sync state — probe must report 'in-sync', no issue creation"
out=$(MOCK_GH_TAG=v1.2.3 \
      MOCK_GH_PUBLISHED_AT="$(ago_hours 1)" \
      MOCK_GH_HAS_WINDOWS_ASSET=true \
      MOCK_WINGET_VERSIONS="1.2.0
1.2.1
1.2.3" \
      MOCK_EXISTING_ISSUES_COUNT=0 \
      DRY_RUN=1 \
      bash "$PROBE" 2>&1)
if ! echo "$out" | grep -q "STATUS: in-sync"; then
  echo "FAIL: in-sync test did not report in-sync. Output:"
  echo "$out"
  exit 1
fi
if echo "$out" | grep -q "issue created\|DRY_RUN: would create issue"; then
  echo "FAIL: in-sync test attempted to create an issue. Output:"
  echo "$out"
  exit 1
fi
echo "  PASS"

# ---- Test 2: drift <72h ----
echo "Test 2: drift <72h — probe must report 'within 72h grace', no issue creation"
out=$(MOCK_GH_TAG=v1.2.4 \
      MOCK_GH_PUBLISHED_AT="$(ago_hours 24)" \
      MOCK_GH_HAS_WINDOWS_ASSET=true \
      MOCK_WINGET_VERSIONS="1.2.3" \
      MOCK_EXISTING_ISSUES_COUNT=0 \
      DRY_RUN=1 \
      bash "$PROBE" 2>&1)
if ! echo "$out" | grep -q "STATUS: drift within 72h grace"; then
  echo "FAIL: <72h drift test did not match expected status. Output:"
  echo "$out"
  exit 1
fi
if echo "$out" | grep -q "DRY_RUN: would create issue"; then
  echo "FAIL: <72h drift test attempted to create an issue. Output:"
  echo "$out"
  exit 1
fi
echo "  PASS"

# ---- Test 3: drift >72h, no existing issue ----
echo "Test 3: drift >72h with no existing issue — probe MUST create issue"
out=$(MOCK_GH_TAG=v1.2.4 \
      MOCK_GH_PUBLISHED_AT="$(ago_hours 96)" \
      MOCK_GH_HAS_WINDOWS_ASSET=true \
      MOCK_WINGET_VERSIONS="1.2.3" \
      MOCK_EXISTING_ISSUES_COUNT=0 \
      DRY_RUN=1 \
      bash "$PROBE" 2>&1)
if ! echo "$out" | grep -q "DRY_RUN: would create issue"; then
  echo "FAIL: >72h drift test did not attempt to create issue. Output:"
  echo "$out"
  exit 1
fi
if ! echo "$out" | grep -q "\[winget-drift\] WinGet manifest is"; then
  echo "FAIL: issue title format incorrect. Output:"
  echo "$out"
  exit 1
fi
if ! echo "$out" | grep -q "STATUS: drift >.*h — issue created"; then
  echo "FAIL: status message incorrect. Output:"
  echo "$out"
  exit 1
fi
echo "  PASS"

# ---- Test 4: drift >72h with existing open issue ----
echo "Test 4: drift >72h with existing open issue — probe MUST NOT create duplicate"
out=$(MOCK_GH_TAG=v1.2.4 \
      MOCK_GH_PUBLISHED_AT="$(ago_hours 96)" \
      MOCK_GH_HAS_WINDOWS_ASSET=true \
      MOCK_WINGET_VERSIONS="1.2.3" \
      MOCK_EXISTING_ISSUES_COUNT=1 \
      DRY_RUN=1 \
      bash "$PROBE" 2>&1)
if ! echo "$out" | grep -q "STATUS: drift >.*h but open \[winget-drift\] issue already exists; skipping."; then
  echo "FAIL: existing-issue dedup did not match expected status. Output:"
  echo "$out"
  exit 1
fi
if echo "$out" | grep -q "DRY_RUN: would create issue"; then
  echo "FAIL: existing-issue dedup attempted to create duplicate. Output:"
  echo "$out"
  exit 1
fi
echo "  PASS"

# ---- Test 5: WinGet directory missing ----
echo "Test 5: WinGet directory missing — probe must handle gracefully"
out=$(MOCK_GH_TAG=v1.2.4 \
      MOCK_GH_PUBLISHED_AT="$(ago_hours 96)" \
      MOCK_GH_HAS_WINDOWS_ASSET=true \
      MOCK_WINGET_VERSIONS="" \
      MOCK_EXISTING_ISSUES_COUNT=0 \
      DRY_RUN=1 \
      bash "$PROBE" 2>&1)
if ! echo "$out" | grep -q "WinGet manifest directory does not exist yet"; then
  echo "FAIL: WinGet missing test did not match expected message. Output:"
  echo "$out"
  exit 1
fi
echo "  PASS"

# ---- Test 6: release has no Windows asset ----
echo "Test 6: release with no hookwarden-windows-x64.exe — probe must skip cleanly"
out=$(MOCK_GH_TAG=v0.1.1 \
      MOCK_GH_PUBLISHED_AT="$(ago_hours 200)" \
      MOCK_GH_HAS_WINDOWS_ASSET=false \
      MOCK_WINGET_VERSIONS="" \
      MOCK_EXISTING_ISSUES_COUNT=0 \
      DRY_RUN=1 \
      bash "$PROBE" 2>&1)
if ! echo "$out" | grep -q "no hookwarden-windows-x64.exe asset — nothing to package for WinGet"; then
  echo "FAIL: no-asset skip message missing. Output:"
  echo "$out"
  exit 1
fi
if echo "$out" | grep -q "DRY_RUN: would create issue"; then
  echo "FAIL: no-asset release attempted to create an issue. Output:"
  echo "$out"
  exit 1
fi
if echo "$out" | grep -qE "Drift age:|STATUS: drift"; then
  echo "FAIL: no-asset release proceeded past the skip gate. Output:"
  echo "$out"
  exit 1
fi
echo "  PASS"

echo
echo "All 6 drift-probe tests passed."
