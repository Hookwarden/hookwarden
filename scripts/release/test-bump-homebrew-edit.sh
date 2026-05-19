#!/usr/bin/env bash
# scripts/release/test-bump-homebrew-edit.sh
# Fixture-driven test for bump-homebrew-edit.sh — the edit core that bug 7
# (issue #12) regressed in v0.3.0. Asserts both happy-path and adversarial
# inputs around the macOS-deferred formula shape.
#
# Style matches scripts/release/test-parity-gate-mutation.sh:
# plain bash + temp dir + per-case isolation + clear FAIL/PASS lines.

set -euo pipefail

cd "$(dirname "$0")/../.."
EDIT=scripts/release/bump-homebrew-edit.sh

SHA_LA=$(printf 'a%.0s' {1..64})  # linux-arm fixture
SHA_LX=$(printf 'b%.0s' {1..64})  # linux-x64 fixture
SHA_WX=$(printf 'c%.0s' {1..64})  # windows-x64 fixture
SHA_DA=$(printf 'd%.0s' {1..64})  # darwin-arm fixture (regression scaffold)
SHA_DX=$(printf 'e%.0s' {1..64})  # darwin-x64 fixture

mk_formula_v030() {
  # The current Linux-only formula shape (post-#1 merge): 2 sha256 lines
  # (top-level linux-arm + on_linux.on_intel linux-x64), URLs hardcode
  # `v0.3.0` (no `version` line — auto-derives from top-level url).
  cat > "$1" <<EOF
class Hookwarden < Formula
  desc "Webhook signature-verification audit tool"
  homepage "https://hookwarden.dev"
  url "https://github.com/Hookwarden/hookwarden/releases/download/v0.3.0/hookwarden-linux-arm64"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "Apache-2.0"

  depends_on :linux

  on_linux do
    on_intel do
      url "https://github.com/Hookwarden/hookwarden/releases/download/v0.3.0/hookwarden-linux-x64"
      sha256 "1111111111111111111111111111111111111111111111111111111111111111"
    end
  end
end
EOF
}

mk_formula_v020() {
  # The OLD v0.2.0 formula shape (4 sha256 lines, on_macos + on_linux).
  # bump-homebrew-edit.sh MUST fail loudly on this — the python assertion
  # catches it. Regression scaffold: if the formula ever silently regrows
  # macOS blocks without a coupled script update, this test fires.
  cat > "$1" <<EOF
class Hookwarden < Formula
  version "0.2.0"
  on_macos do
    on_arm do
      sha256 "2222222222222222222222222222222222222222222222222222222222222222"
    end
    on_intel do
      sha256 "3333333333333333333333333333333333333333333333333333333333333333"
    end
  end
  on_linux do
    on_arm do
      sha256 "4444444444444444444444444444444444444444444444444444444444444444"
    end
    on_intel do
      sha256 "5555555555555555555555555555555555555555555555555555555555555555"
    end
  end
end
EOF
}

# ---- Test 1: happy path (3-target checksums) ----
echo "Test 1: 3-target Linux+Windows checksums + Linux-only formula → succeeds, both URL versions + both sha256 lines updated"
TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
${SHA_WX}  hookwarden-windows-x64.exe
EOF
mk_formula_v030 "$TMP/hookwarden.rb"
bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.3.1 > /dev/null
# Both URLs should be v0.3.1 now
urls=$(grep -cE 'releases/download/v0\.3\.1/' "$TMP/hookwarden.rb" || true)
if [[ "$urls" != "2" ]]; then
  echo "FAIL: expected 2 v0.3.1 URLs, got $urls"
  cat "$TMP/hookwarden.rb"
  exit 1
fi
# sha256 lines should match SHA_LA + SHA_LX in order
if ! grep -q "sha256 \"${SHA_LA}\"" "$TMP/hookwarden.rb"; then
  echo "FAIL: linux-arm sha not pinned"
  cat "$TMP/hookwarden.rb"
  exit 1
fi
if ! grep -q "sha256 \"${SHA_LX}\"" "$TMP/hookwarden.rb"; then
  echo "FAIL: linux-x64 sha not pinned"
  cat "$TMP/hookwarden.rb"
  exit 1
fi
echo "  PASS"

# ---- Test 2: 5-target checksums (incl darwin) → still succeeds, darwin ignored ----
echo "Test 2: 5-target checksums (incl darwin) → script ignores darwin extras, succeeds"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_DA}  hookwarden-darwin-arm64
${SHA_DX}  hookwarden-darwin-x64
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
${SHA_WX}  hookwarden-windows-x64.exe
EOF
mk_formula_v030 "$TMP/hookwarden.rb"
bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.3.1 > /dev/null
# Linux SHAs in formula; darwin SHAs MUST NOT appear in formula
if grep -q "$SHA_DA\|$SHA_DX" "$TMP/hookwarden.rb"; then
  echo "FAIL: darwin SHAs leaked into Linux-only formula"
  cat "$TMP/hookwarden.rb"
  exit 1
fi
if ! grep -q "$SHA_LA" "$TMP/hookwarden.rb" || ! grep -q "$SHA_LX" "$TMP/hookwarden.rb"; then
  echo "FAIL: linux SHAs missing"
  exit 1
fi
echo "  PASS"

# ---- Test 3: missing linux-arm64 SHA → exits 1 with self-describing error ----
echo "Test 3: checksums.txt missing hookwarden-linux-arm64 → script MUST fail loudly"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LX}  hookwarden-linux-x64
${SHA_WX}  hookwarden-windows-x64.exe
EOF
mk_formula_v030 "$TMP/hookwarden.rb"
if bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.3.1 2>/dev/null; then
  echo "FAIL: missing linux-arm64 SHA should have triggered failure"
  exit 1
fi
echo "  PASS (script correctly rejected missing linux-arm64 pin)"

# ---- Test 4: formula has 4 sha256 lines (old shape) → exits 1 ----
echo "Test 4: formula with old v0.2.0 shape (4 sha256 lines) → python assertion MUST fail"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
${SHA_WX}  hookwarden-windows-x64.exe
EOF
mk_formula_v020 "$TMP/hookwarden.rb"
if bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.3.1 2>/dev/null; then
  echo "FAIL: old 4-sha256-line formula should have failed the assertion"
  exit 1
fi
echo "  PASS (script correctly refused to silently regrow macOS support)"

# ---- Test 5: malformed (non-hex) SHA → exits 1 ----
echo "Test 5: malformed (non-hex) SHA → regex validation MUST fail"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
NOT-A-VALID-SHA-AT-ALL-NOT-A-VALID-SHA-AT-ALL-NOT-A-VALID-SHA-AT  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
EOF
mk_formula_v030 "$TMP/hookwarden.rb"
if bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.3.1 2>/dev/null; then
  echo "FAIL: malformed SHA should have failed the [a-f0-9]{64} regex"
  exit 1
fi
echo "  PASS"

# ---- Test 6: idempotence (running twice produces the same formula) ----
echo "Test 6: idempotence — running edit twice on the same inputs is a no-op on the second run"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
${SHA_WX}  hookwarden-windows-x64.exe
EOF
mk_formula_v030 "$TMP/hookwarden.rb"
bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.3.1 > /dev/null
checksum_first=$(shasum "$TMP/hookwarden.rb" | awk '{print $1}')
bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.3.1 > /dev/null
checksum_second=$(shasum "$TMP/hookwarden.rb" | awk '{print $1}')
if [[ "$checksum_first" != "$checksum_second" ]]; then
  echo "FAIL: second run produced a different formula — not idempotent"
  echo "first:  $checksum_first"
  echo "second: $checksum_second"
  exit 1
fi
echo "  PASS"

echo
echo "All 6 bump-homebrew-edit tests passed."
