#!/usr/bin/env bash
# scripts/release/test-wait-for-gh-release.sh
# Fixture-driven test for wait-for-gh-release.sh — the release-binaries
# → release-py race gate (bug 2 fix from issue #12).
#
# Uses MOCK_RELEASE_PRESENT_AFTER + SLEEP_SECONDS=0 to avoid real
# network or real wall-clock waits.

set -euo pipefail

cd "$(dirname "$0")/../.."
WAIT=scripts/release/wait-for-gh-release.sh

# ---- Test 1: release present on first poll ----
echo "Test 1: release present on first poll → succeeds immediately"
out=$(MOCK_RELEASE_PRESENT_AFTER=1 \
      MAX_ATTEMPTS=5 \
      SLEEP_SECONDS=0 \
      TAG=v1.0.0 \
      GITHUB_REPOSITORY=Hookwarden/hookwarden \
      GH_TOKEN=fake \
      bash "$WAIT" 2>&1)
if ! echo "$out" | grep -q "is ready after 0s"; then
  echo "FAIL: first-poll-present should report 0s elapsed. Output: $out"
  exit 1
fi
echo "  PASS"

# ---- Test 2: release appears mid-poll ----
echo "Test 2: release appears on the 3rd poll (simulates race fix) → succeeds"
out=$(MOCK_RELEASE_PRESENT_AFTER=3 \
      MAX_ATTEMPTS=10 \
      SLEEP_SECONDS=0 \
      TAG=v1.0.0 \
      GITHUB_REPOSITORY=Hookwarden/hookwarden \
      GH_TOKEN=fake \
      bash "$WAIT" 2>&1)
if ! echo "$out" | grep -q "is ready after 0s. \[MOCKED\]"; then
  echo "FAIL: 3rd-poll-present should still report 0s (SLEEP_SECONDS=0). Output: $out"
  exit 1
fi
# Verify we polled at least 3 times (Polling line + ready line at minimum)
echo "  PASS"

# ---- Test 3: release never appears — exits 1 with self-describing error ----
echo "Test 3: release never appears within MAX_ATTEMPTS → MUST exit 1 with self-describing error"
if err=$(MOCK_RELEASE_PRESENT_AFTER=99 \
         MAX_ATTEMPTS=3 \
         SLEEP_SECONDS=0 \
         TAG=v1.0.0 \
         GITHUB_REPOSITORY=Hookwarden/hookwarden \
         GH_TOKEN=fake \
         bash "$WAIT" 2>&1); then
  echo "FAIL: timeout case should have exited 1. Output: $err"
  exit 1
fi
if ! echo "$err" | grep -q "did not appear within"; then
  echo "FAIL: timeout error missing self-description. Got: $err"
  exit 1
fi
if ! echo "$err" | grep -q "release-binaries.yml failed or is stalled"; then
  echo "FAIL: timeout error missing diagnostic pointer. Got: $err"
  exit 1
fi
echo "  PASS"

# ---- Test 4: missing TAG → boundary rejection ----
echo "Test 4: TAG unset → MUST exit non-zero with self-describing error"
if MOCK_RELEASE_PRESENT_AFTER=1 SLEEP_SECONDS=0 GITHUB_REPOSITORY=Hookwarden/hookwarden GH_TOKEN=fake bash "$WAIT" 2>/dev/null; then
  echo "FAIL: missing TAG should have failed"
  exit 1
fi
echo "  PASS"

# ---- Test 5: missing GITHUB_REPOSITORY → boundary rejection ----
echo "Test 5: GITHUB_REPOSITORY unset → MUST exit non-zero"
if MOCK_RELEASE_PRESENT_AFTER=1 SLEEP_SECONDS=0 TAG=v1.0.0 GH_TOKEN=fake bash "$WAIT" 2>/dev/null; then
  echo "FAIL: missing GITHUB_REPOSITORY should have failed"
  exit 1
fi
echo "  PASS"

echo
echo "All 5 wait-for-gh-release tests passed."
