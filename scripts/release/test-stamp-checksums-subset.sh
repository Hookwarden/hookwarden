#!/usr/bin/env bash
# scripts/release/test-stamp-checksums-subset.sh
# Fixture-driven test for stamp-checksums.py — the REQUIRED_TARGETS subset
# behavior that bug 5 (issue #12) regressed in v0.3.0.
#
# Uses a fake `gh` on PATH that copies a fixture file in response to
# `gh release download --pattern checksums.txt`. Sets RUNNER_TEMP for
# checksums.txt staging, and runs from a tmp work dir with the expected
# python-packages skeleton so the script can write SHIM_DATA.

set -euo pipefail

cd "$(dirname "$0")/../.."
SCRIPT=$PWD/scripts/release/stamp-checksums.py

# Per-test fixture setup. Recreates the work dir + fakebin + runner_temp
# for each case to avoid cross-test leakage.
setup_case() {
  local fixture_content=$1
  TMP=$(mktemp -d)
  mkdir -p "$TMP/fakebin"
  mkdir -p "$TMP/work/python-packages/hookwarden/src/hookwarden/_data"
  mkdir -p "$TMP/runner-temp"
  printf "%s" "$fixture_content" > "$TMP/fixture.txt"

  # Fake gh: parses out the --output target and copies the fixture there.
  cat > "$TMP/fakebin/gh" <<'EOF'
#!/usr/bin/env bash
# Only handles: gh release download <ver> --repo <r> --pattern <p> --output <path>
out=""
prev=""
for arg in "$@"; do
  if [[ "$prev" == "--output" ]]; then out="$arg"; fi
  prev="$arg"
done
if [[ -z "$out" ]]; then
  echo "fake-gh: no --output flag" >&2; exit 1
fi
cp "$FAKE_FIXTURE" "$out"
EOF
  chmod +x "$TMP/fakebin/gh"
}

run_stamp() {
  local version=$1
  (
    cd "$TMP/work"
    PATH="$TMP/fakebin:$PATH" \
      RUNNER_TEMP="$TMP/runner-temp" \
      FAKE_FIXTURE="$TMP/fixture.txt" \
      python3 "$SCRIPT" "$version"
  )
}

cleanup() { [[ -n "${TMP:-}" && -d "$TMP" ]] && rm -rf "$TMP"; }
trap cleanup EXIT

SHA_LA=$(printf 'a%.0s' {1..64})
SHA_LX=$(printf 'b%.0s' {1..64})
SHA_WX=$(printf 'c%.0s' {1..64})
SHA_DA=$(printf 'd%.0s' {1..64})
SHA_DX=$(printf 'e%.0s' {1..64})

# ---- Test 1: 3-target REQUIRED_TARGETS subset (post-v0.3.0 baseline) ----
echo "Test 1: 3-target Linux+Windows checksums (REQUIRED_TARGETS exact) → succeeds, 3 pins written"
setup_case "${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
${SHA_WX}  hookwarden-windows-x64.exe
"
run_stamp v1.0.0 > /dev/null
JSON="$TMP/work/python-packages/hookwarden/src/hookwarden/_data/checksums.json"
[[ -f "$JSON" ]] || { echo "FAIL: SHIM_DATA file not written"; exit 1; }
count=$(python3 -c "import json,sys; print(len(json.load(open('$JSON'))))")
[[ "$count" == "3" ]] || { echo "FAIL: expected 3 pins, got $count"; cat "$JSON"; exit 1; }
grep -q "$SHA_LA" "$JSON" && grep -q "$SHA_LX" "$JSON" && grep -q "$SHA_WX" "$JSON" || {
  echo "FAIL: expected SHAs missing from output"; cat "$JSON"; exit 1;
}
echo "  PASS"
cleanup

# ---- Test 2: 5-target (incl darwin) → succeeds, 5 pins (darwin not required but pinned) ----
echo "Test 2: 5-target checksums (incl darwin) → succeeds, 5 pins written"
setup_case "${SHA_DA}  hookwarden-darwin-arm64
${SHA_DX}  hookwarden-darwin-x64
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
${SHA_WX}  hookwarden-windows-x64.exe
"
run_stamp v1.0.0 > /dev/null
JSON="$TMP/work/python-packages/hookwarden/src/hookwarden/_data/checksums.json"
count=$(python3 -c "import json,sys; print(len(json.load(open('$JSON'))))")
[[ "$count" == "5" ]] || { echo "FAIL: expected 5 pins, got $count"; cat "$JSON"; exit 1; }
echo "  PASS"
cleanup

# ---- Test 3: missing required linux-arm64 → fails loudly ----
echo "Test 3: checksums.txt missing hookwarden-linux-arm64 (REQUIRED_TARGETS member) → MUST fail"
setup_case "${SHA_LX}  hookwarden-linux-x64
${SHA_WX}  hookwarden-windows-x64.exe
"
if err=$(run_stamp v1.0.0 2>&1); then
  echo "FAIL: missing required target should have triggered failure. Output: $err"
  exit 1
fi
# Error message must self-describe (DC-19 quality: never silent on missing required targets)
if ! echo "$err" | grep -q "missing pins"; then
  echo "FAIL: error message missing self-description. Got: $err"
  exit 1
fi
echo "  PASS"
cleanup

# ---- Test 4: missing required windows-x64 (regression for v0.3.0+ Windows scoop bumps) ----
echo "Test 4: checksums.txt missing hookwarden-windows-x64.exe → MUST fail"
setup_case "${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
"
if run_stamp v1.0.0 2>/dev/null; then
  echo "FAIL: missing windows-x64 should have failed"
  exit 1
fi
echo "  PASS"
cleanup

# ---- Test 5: malformed (non-hex) SHA → regex rejection (no false pins) ----
echo "Test 5: malformed (non-hex) SHA → regex skips, REQUIRED_TARGETS check then fails"
setup_case "NOT-HEX-AT-ALL-NOT-HEX-AT-ALL-NOT-HEX-AT-ALL-NOT-HEX-AT-ALL-XXXX  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
${SHA_WX}  hookwarden-windows-x64.exe
"
if run_stamp v1.0.0 2>/dev/null; then
  echo "FAIL: malformed sha line should have caused missing-pins failure"
  exit 1
fi
echo "  PASS"
cleanup

# ---- Test 6: version without 'v' prefix → boundary rejection ----
echo "Test 6: version arg without leading 'v' (e.g. '1.0.0') → MUST fail with self-describing error"
setup_case "${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
${SHA_WX}  hookwarden-windows-x64.exe
"
if err=$(run_stamp 1.0.0 2>&1); then
  echo "FAIL: missing 'v' prefix should have failed"
  exit 1
fi
if ! echo "$err" | grep -q "must start with 'v'"; then
  echo "FAIL: error did not flag the missing 'v'. Got: $err"
  exit 1
fi
echo "  PASS"
cleanup

# ---- Test 7: unrecognized artifact alongside required ones → succeeds, extras logged + skipped ----
echo "Test 7: unrecognized artifact (e.g. hookwarden-future-arch) → INFO-logged, ignored, required set still satisfied"
setup_case "${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
${SHA_WX}  hookwarden-windows-x64.exe
0000000000000000000000000000000000000000000000000000000000000000  hookwarden-future-fictional-arch
"
out=$(run_stamp v1.0.0 2>&1)
if ! echo "$out" | grep -q "ignoring unrecognized artifact"; then
  echo "FAIL: extra artifact should have been INFO-logged. Output: $out"
  exit 1
fi
JSON="$TMP/work/python-packages/hookwarden/src/hookwarden/_data/checksums.json"
count=$(python3 -c "import json,sys; print(len(json.load(open('$JSON'))))")
[[ "$count" == "3" ]] || { echo "FAIL: expected 3 pins (extra ignored), got $count"; exit 1; }
echo "  PASS"
cleanup

echo
echo "All 7 stamp-checksums tests passed."
