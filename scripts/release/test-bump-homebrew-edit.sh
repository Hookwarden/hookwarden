#!/usr/bin/env bash
# scripts/release/test-bump-homebrew-edit.sh
# Fixture-driven test for bump-homebrew-edit.sh — the edit core for the
# Hookwarden/homebrew-tap formula. Covers the npm-wrapper-on-macOS shape
# (3 sha256 lines) with happy-path + adversarial inputs.
#
# Style matches scripts/release/test-parity-gate-mutation.sh:
# plain bash + temp dir + per-case isolation + clear FAIL/PASS lines.

set -euo pipefail

cd "$(dirname "$0")/../.."
EDIT=scripts/release/bump-homebrew-edit.sh

SHA_NM=$(printf 'a%.0s' {1..64})  # npm-tarball fixture (macOS path)
SHA_LA=$(printf 'b%.0s' {1..64})  # linux-arm fixture
SHA_LX=$(printf 'c%.0s' {1..64})  # linux-x64 fixture
SHA_WX=$(printf 'd%.0s' {1..64})  # windows-x64 fixture (ignored by bump)
SHA_DA=$(printf 'e%.0s' {1..64})  # darwin-arm fixture (must NOT appear in formula)

mk_formula_v040() {
  # The current formula shape: npm tarball top-level, on_linux/on_arm +
  # on_linux/on_intel binary URLs. macOS gets node-wrapped via on_macos
  # depends_on. 3 sha256 lines total.
  cat > "$1" <<EOF
class Hookwarden < Formula
  desc "Webhook signature-verification audit tool"
  homepage "https://hookwarden.dev"
  url "https://registry.npmjs.org/hookwarden/-/hookwarden-0.4.0.tgz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "Apache-2.0"

  on_macos do
    depends_on "node"
  end

  on_linux do
    on_arm do
      url "https://github.com/Hookwarden/hookwarden/releases/download/v0.4.0/hookwarden-linux-arm64"
      sha256 "1111111111111111111111111111111111111111111111111111111111111111"
    end
    on_intel do
      url "https://github.com/Hookwarden/hookwarden/releases/download/v0.4.0/hookwarden-linux-x64"
      sha256 "2222222222222222222222222222222222222222222222222222222222222222"
    end
  end
end
EOF
}

mk_formula_v030_legacy() {
  # The OLD v0.3.x Linux-only shape (2 sha256 lines, no npm tarball, no on_macos).
  # bump-homebrew-edit.sh MUST fail loudly on this — the python assertion
  # catches it. Regression scaffold: if the formula ever gets reverted to
  # Linux-only without a coupled script downgrade, this test fires.
  cat > "$1" <<EOF
class Hookwarden < Formula
  url "https://github.com/Hookwarden/hookwarden/releases/download/v0.3.0/hookwarden-linux-arm64"
  version "0.3.0"
  sha256 "3333333333333333333333333333333333333333333333333333333333333333"
  depends_on :linux
  on_linux do
    on_intel do
      url "https://github.com/Hookwarden/hookwarden/releases/download/v0.3.0/hookwarden-linux-x64"
      sha256 "4444444444444444444444444444444444444444444444444444444444444444"
    end
  end
end
EOF
}

# ---- Test 1: happy path (3-sha shape, both URL patterns bumped) ----
echo "Test 1: 3-sha formula → npm URL + 2 GH URLs bumped, 3 sha256 lines pinned in source order"
TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
${SHA_WX}  hookwarden-windows-x64.exe
EOF
mk_formula_v040 "$TMP/hookwarden.rb"
bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.4.1 "$SHA_NM" > /dev/null

# Both GH URLs should be v0.4.1 now
gh_urls=$(grep -cE 'releases/download/v0\.4\.1/' "$TMP/hookwarden.rb" || true)
if [[ "$gh_urls" != "2" ]]; then
  echo "FAIL: expected 2 v0.4.1 GH URLs, got $gh_urls"
  cat "$TMP/hookwarden.rb"
  exit 1
fi
# npm tarball URL should be 0.4.1.tgz now
if ! grep -q 'hookwarden-0\.4\.1\.tgz' "$TMP/hookwarden.rb"; then
  echo "FAIL: npm tarball URL not bumped to 0.4.1.tgz"
  cat "$TMP/hookwarden.rb"
  exit 1
fi
# 3 sha256 lines must match SHA_NM, SHA_LA, SHA_LX in source order
shas_in_order=$(grep -oE 'sha256 "[a-f0-9]{64}"' "$TMP/hookwarden.rb")
expected_order=$(printf 'sha256 "%s"\nsha256 "%s"\nsha256 "%s"' "$SHA_NM" "$SHA_LA" "$SHA_LX")
if [[ "$shas_in_order" != "$expected_order" ]]; then
  echo "FAIL: sha256 lines not pinned in source order"
  echo "expected:"; echo "$expected_order"
  echo "got:";      echo "$shas_in_order"
  exit 1
fi
# Stale version line must NOT be inserted (the new formula has no version line).
if grep -qE '^\s*version\s+"' "$TMP/hookwarden.rb"; then
  echo "FAIL: stale 'version' line present after bump (current formula auto-derives from npm URL)"
  cat "$TMP/hookwarden.rb"
  exit 1
fi
echo "  PASS"

# ---- Test 2: 5-target checksums (incl darwin extras) → darwin SHAs MUST NOT leak ----
echo "Test 2: 5-target checksums (incl darwin) → script ignores darwin extras, succeeds"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_DA}  hookwarden-darwin-arm64
${SHA_DA}  hookwarden-darwin-x64
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
${SHA_WX}  hookwarden-windows-x64.exe
EOF
mk_formula_v040 "$TMP/hookwarden.rb"
bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.4.1 "$SHA_NM" > /dev/null
# darwin SHAs MUST NOT appear in formula (macOS uses the npm SHA, not the GH-release one)
if grep -q "$SHA_DA" "$TMP/hookwarden.rb"; then
  echo "FAIL: darwin SHA leaked into formula"
  cat "$TMP/hookwarden.rb"
  exit 1
fi
echo "  PASS"

# ---- Test 3: missing linux-arm64 SHA → exits 1 ----
echo "Test 3: checksums.txt missing hookwarden-linux-arm64 → script MUST fail loudly"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LX}  hookwarden-linux-x64
${SHA_WX}  hookwarden-windows-x64.exe
EOF
mk_formula_v040 "$TMP/hookwarden.rb"
if bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.4.1 "$SHA_NM" 2>/dev/null; then
  echo "FAIL: missing linux-arm64 SHA should have triggered failure"
  exit 1
fi
echo "  PASS (script correctly rejected missing linux-arm64 pin)"

# ---- Test 4: legacy 2-sha formula (old Linux-only shape) → exits 1 ----
echo "Test 4: legacy v0.3.x 2-sha formula → python assertion MUST fail"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
${SHA_WX}  hookwarden-windows-x64.exe
EOF
mk_formula_v030_legacy "$TMP/hookwarden.rb"
if bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.4.1 "$SHA_NM" 2>/dev/null; then
  echo "FAIL: legacy 2-sha formula should have failed the assertion"
  exit 1
fi
echo "  PASS (script correctly refused to silently regress to Linux-only shape)"

# ---- Test 5: malformed (non-hex) Linux SHA → exits 1 ----
echo "Test 5: malformed (non-hex) Linux SHA → regex validation MUST fail"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
NOT-A-VALID-SHA-AT-ALL-NOT-A-VALID-SHA-AT-ALL-NOT-A-VALID-SHA-AT  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
EOF
mk_formula_v040 "$TMP/hookwarden.rb"
if bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.4.1 "$SHA_NM" 2>/dev/null; then
  echo "FAIL: malformed Linux SHA should have failed the [a-f0-9]{64} regex"
  exit 1
fi
echo "  PASS"

# ---- Test 6: malformed npm SHA → exits 1 ----
echo "Test 6: malformed (non-hex) npm SHA arg → regex validation MUST fail"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
EOF
mk_formula_v040 "$TMP/hookwarden.rb"
if bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.4.1 "not-a-sha" 2>/dev/null; then
  echo "FAIL: malformed npm SHA should have failed the [a-f0-9]{64} regex"
  exit 1
fi
echo "  PASS"

# ---- Test 7: idempotence ----
echo "Test 7: idempotence — running edit twice on the same inputs is a no-op on the second run"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
${SHA_WX}  hookwarden-windows-x64.exe
EOF
mk_formula_v040 "$TMP/hookwarden.rb"
bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.4.1 "$SHA_NM" > /dev/null
checksum_first=$(shasum "$TMP/hookwarden.rb" | awk '{print $1}')
bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.4.1 "$SHA_NM" > /dev/null
checksum_second=$(shasum "$TMP/hookwarden.rb" | awk '{print $1}')
if [[ "$checksum_first" != "$checksum_second" ]]; then
  echo "FAIL: second run produced a different formula — not idempotent"
  echo "first:  $checksum_first"
  echo "second: $checksum_second"
  exit 1
fi
echo "  PASS"

echo
echo "All 7 bump-homebrew-edit tests passed."
