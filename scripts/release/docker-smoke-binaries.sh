#!/usr/bin/env bash
# Docker-based smoke harness for hookwarden compiled binaries.
#
# Tests each Bun --compile binary across multiple Linux distributions,
# proving that:
#   1. Binary executes without runtime errors (no /$bunfs gotchas, etc.)
#   2. CLI subcommands resolve correctly (citty wiring intact)
#   3. JS/TS parsing works in compiled-Bun context (Babel loaded)
#   4. Python parsing works in compiled-Bun context (DC-13 dual-path WASM
#      loader resolves the embedded asset, not the source-tree path)
#   5. Exit-code matrix is correct (CLI-04 contract preserved through compile)
#
# Cross-arch: this script runs on any host with Docker installed. linux-x64
# binaries run via Rosetta on macOS arm64 hosts; linux-arm64 binaries run
# natively on arm64 hosts and via qemu-user on x86 hosts (slow but functional).
#
# Usage:
#   ./scripts/release/docker-smoke-binaries.sh <binaries-dir> [--quick] [--keep-going]
#
#   <binaries-dir>: directory containing hookwarden-{linux-arm64,linux-x64,...}
#                   binaries. Typically /tmp/hookwarden-smoke after a `gh run download`.
#   --quick:        skip the alpine/musl probe (which is expected to fail and is
#                   informational only).
#   --keep-going:   continue running tests after the first failure (default: stop
#                   on first failure to keep CI logs short).
#
# Exit codes:
#   0  all required tests passed
#   1  one or more required tests failed
#   2  setup error (missing docker, missing binaries, etc.)
#
# Designed to run identically locally and in GitHub Actions. The companion
# workflow `release-binaries-docker-smoke.yml` (Phase 4.2 wave 3 follow-up)
# downloads the workflow artifacts and pipes them into this script.

set -euo pipefail

# ─── arg parsing ─────────────────────────────────────────────────────────────

if [ $# -lt 1 ]; then
  echo "usage: $0 <binaries-dir> [--quick] [--keep-going]" >&2
  exit 2
fi

BINARIES_DIR="$1"; shift || true
QUICK=0
KEEP_GOING=0
while [ $# -gt 0 ]; do
  case "$1" in
    --quick) QUICK=1 ;;
    --keep-going) KEEP_GOING=1 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ ! -d "$BINARIES_DIR" ]; then
  echo "error: binaries-dir does not exist: $BINARIES_DIR" >&2
  exit 2
fi
BINARIES_DIR="$(cd "$BINARIES_DIR" && pwd)"

# ─── env discovery ───────────────────────────────────────────────────────────

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker not found in PATH" >&2
  exit 2
fi

if ! docker info >/dev/null 2>&1; then
  echo "error: docker daemon is not reachable. Start Docker Desktop and retry." >&2
  exit 2
fi

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
FIXTURES_ROOT="$REPO_ROOT/e2e/fixtures/phase-3"
if [ ! -d "$FIXTURES_ROOT" ]; then
  echo "error: fixtures dir not found: $FIXTURES_ROOT" >&2
  exit 2
fi

# ─── test matrix ─────────────────────────────────────────────────────────────

# (binary_name, docker_image, platform)
# Platform is passed to `docker run --platform`; on macOS arm64 hosts, linux/amd64
# uses Rosetta; on x86 hosts, linux/arm64 uses qemu-user (set up by Docker Desktop).
MATRIX=(
  "hookwarden-linux-x64    ubuntu:22.04   linux/amd64"
  "hookwarden-linux-x64    ubuntu:24.04   linux/amd64"
  "hookwarden-linux-x64    debian:12      linux/amd64"
  "hookwarden-linux-x64    fedora:40      linux/amd64"
  "hookwarden-linux-arm64  ubuntu:22.04   linux/arm64"
  "hookwarden-linux-arm64  debian:12      linux/arm64"
)

# Informational-only probe: musl-based Alpine. Bun's --target=bun-linux-{x64,arm64}
# requires glibc; we expect this to fail with a "not found" or symbol-resolution
# error. Skip when --quick.
ALPINE_PROBE=(
  "hookwarden-linux-x64    alpine:3.20    linux/amd64"
)

# ─── test cases (per binary × image) ─────────────────────────────────────────

# Each test is a function returning 0 (pass) or non-zero (fail) plus stderr
# message. The function receives: $1=binary path inside container, $2=fixtures
# path inside container.

# T1: --help exits 0 and mentions the scan subcommand.
test_help() {
  local cmd="$1"
  local out
  out=$("$cmd" --help 2>&1) || return 1
  echo "$out" | grep -q "scan" || { echo "  --help missing 'scan' subcommand"; return 1; }
  return 0
}

# T2: scan --help exits 0 and mentions --fail-on flag.
test_scan_help() {
  local cmd="$1"
  local out
  out=$("$cmd" scan --help 2>&1) || return 1
  echo "$out" | grep -q -- "--fail-on" || { echo "  'scan --help' missing --fail-on flag"; return 1; }
  return 0
}

# T3: scan canonical Stripe bug → exit 1 (active findings)
test_scan_js_bug() {
  local cmd="$1"
  local fixtures="$2"
  local code=0
  "$cmd" scan "$fixtures/canonical-stripe-bug" >/dev/null 2>&1 || code=$?
  if [ "$code" != "1" ]; then
    echo "  scan canonical-stripe-bug exited $code (expected 1)"
    return 1
  fi
  return 0
}

# T4: scan Python flask-bug → finds Python findings (proves DC-13 WASM loader)
test_scan_python_bug() {
  local cmd="$1"
  local fixtures="$2"
  local out
  out=$("$cmd" scan "$fixtures/python-flask-bug" 2>&1) || true
  echo "$out" | grep -q "stripe/" || { echo "  scan python-flask-bug missed stripe rule (WASM loader broken?)"; return 1; }
  echo "$out" | grep -qi "manual-review\|critical\|high" || { echo "  scan python-flask-bug emitted no severity findings"; return 1; }
  return 0
}

# T5: scan happy-path JS → exit 0 (no active findings above threshold)
test_scan_clean_js() {
  local cmd="$1"
  local fixtures="$2"
  local code=0
  "$cmd" scan "$fixtures/stripe-construct-event-happy-path" >/dev/null 2>&1 || code=$?
  if [ "$code" != "0" ]; then
    echo "  scan stripe-construct-event-happy-path exited $code (expected 0)"
    return 1
  fi
  return 0
}

# T6: scan happy-path Python → exit 0
test_scan_clean_python() {
  local cmd="$1"
  local fixtures="$2"
  local code=0
  "$cmd" scan "$fixtures/python-flask-happy-path" >/dev/null 2>&1 || code=$?
  if [ "$code" != "0" ]; then
    echo "  scan python-flask-happy-path exited $code (expected 0)"
    return 1
  fi
  return 0
}

TESTS=(
  "test_help          T1 --help_works"
  "test_scan_help     T2 scan_--help"
  "test_scan_js_bug   T3 scan_js_bug_exit1"
  "test_scan_python_bug T4 scan_python_bug_finds_stripe"
  "test_scan_clean_js   T5 scan_clean_js_exit0"
  "test_scan_clean_python T6 scan_clean_python_exit0"
)

# ─── runner ──────────────────────────────────────────────────────────────────

PASS=0
FAIL=0
FAIL_DETAIL=()

run_in_container() {
  local binary_name="$1" image="$2" platform="$3"
  local binary_path="$BINARIES_DIR/$binary_name"

  if [ ! -f "$binary_path" ]; then
    echo "[ skip ] $binary_name × $image  (binary not present at $binary_path)"
    return 0
  fi

  echo "─── $binary_name × $image ($platform) ───"

  for test_entry in "${TESTS[@]}"; do
    local fn id_label
    fn=$(echo "$test_entry" | awk '{print $1}')
    id_label=$(echo "$test_entry" | awk '{print $2"_"$3}')

    local stderr_capture
    stderr_capture=$(mktemp)

    if docker run --rm --platform "$platform" \
         -v "$binary_path:/usr/local/bin/hookwarden:ro" \
         -v "$FIXTURES_ROOT:/fixtures:ro" \
         -e BIN=/usr/local/bin/hookwarden \
         -e FIX=/fixtures \
         -e FN="$fn" \
         "$image" \
         bash -c "
           $(declare -f "$fn")
           $fn \"\$BIN\" \"\$FIX\"
         " >/dev/null 2>"$stderr_capture"; then
      echo "  ✓ $id_label"
      PASS=$((PASS + 1))
    else
      local detail
      detail=$(cat "$stderr_capture" | tr '\n' ' ' | head -c 300)
      echo "  ✗ $id_label  ($detail)"
      FAIL=$((FAIL + 1))
      FAIL_DETAIL+=("$binary_name × $image: $id_label — $detail")
      if [ "$KEEP_GOING" -eq 0 ]; then
        rm -f "$stderr_capture"
        return 1
      fi
    fi
    rm -f "$stderr_capture"
  done
  return 0
}

# ─── main ────────────────────────────────────────────────────────────────────

echo "════════════════════════════════════════════════════════════════════════"
echo " hookwarden binary smoke harness"
echo " binaries: $BINARIES_DIR"
echo " fixtures: $FIXTURES_ROOT"
echo "════════════════════════════════════════════════════════════════════════"

for entry in "${MATRIX[@]}"; do
  bin=$(echo "$entry" | awk '{print $1}')
  img=$(echo "$entry" | awk '{print $2}')
  plat=$(echo "$entry" | awk '{print $3}')
  if ! run_in_container "$bin" "$img" "$plat"; then
    if [ "$KEEP_GOING" -eq 0 ]; then break; fi
  fi
done

if [ "$QUICK" -eq 0 ]; then
  echo ""
  echo "─── informational: musl/Alpine probe (expected fail; Bun targets glibc) ───"
  for entry in "${ALPINE_PROBE[@]}"; do
    bin=$(echo "$entry" | awk '{print $1}')
    img=$(echo "$entry" | awk '{print $2}')
    plat=$(echo "$entry" | awk '{print $3}')
    binary_path="$BINARIES_DIR/$bin"
    if [ ! -f "$binary_path" ]; then continue; fi
    if docker run --rm --platform "$plat" \
         -v "$binary_path:/usr/local/bin/hookwarden:ro" \
         "$img" /usr/local/bin/hookwarden --help >/dev/null 2>&1; then
      echo "  ⚠ unexpected: $bin runs on $img (musl). Docs claim glibc-only — investigate."
    else
      echo "  ℹ confirmed: $bin fails on $img (musl) as expected — Bun targets glibc"
    fi
  done
fi

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo " results: $PASS pass · $FAIL fail"
echo "════════════════════════════════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "failures:"
  for line in "${FAIL_DETAIL[@]}"; do
    echo "  - $line"
  done
  exit 1
fi
exit 0
