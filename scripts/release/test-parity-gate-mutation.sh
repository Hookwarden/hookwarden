#!/usr/bin/env bash
# scripts/release/test-parity-gate-mutation.sh
# Synthetic mutation test for verify-channel-parity-core.sh.
# Generates 4 fixture files with matching SHAs, asserts core PASSES.
# Then mutates ONE field per channel, asserts core FAILS for each mutation.

set -euo pipefail

cd "$(dirname "$0")/../.."
CORE=scripts/release/verify-channel-parity-core.sh
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Canonical SHAs (5 fake-but-valid 64-hex values) + 1 non-canonical (npm tarball)
SHA_DA=$(printf 'a%.0s' {1..64})
SHA_DX=$(printf 'b%.0s' {1..64})
SHA_LA=$(printf 'c%.0s' {1..64})
SHA_LX=$(printf 'd%.0s' {1..64})
SHA_W=$(printf  'e%.0s' {1..64})
# NPM tarball SHA — NOT in canonical checksums.txt. The npm-wrapper macOS
# formula path pins this independently; parity gate must ignore it.
SHA_NM=$(printf 'f%.0s' {1..64})

# 1. Canonical checksums.txt
cat > "$TMP/checksums.txt" <<EOF
${SHA_DA}  hookwarden-darwin-arm64
${SHA_DX}  hookwarden-darwin-x64
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
${SHA_W}  hookwarden-windows-x64.exe
EOF

# 2. PyPI shim checksums.json
cat > "$TMP/shim.json" <<EOF
{
  "darwin-arm64": "${SHA_DA}",
  "darwin-x64":   "${SHA_DX}",
  "linux-arm64":  "${SHA_LA}",
  "linux-x64":    "${SHA_LX}",
  "windows-x64":  "${SHA_W}"
}
EOF

# 3. Homebrew formula — current shape: top-level npm tarball + on_linux binaries.
#    The npm tarball SHA is NOT in canonical (its integrity is verified via
#    the npm registry's own publish chain), so parity gate must skip it and
#    only validate the Linux binary SHAs that pair with releases/download/ URLs.
cat > "$TMP/formula.rb" <<EOF
class Hookwarden < Formula
  url "https://registry.npmjs.org/hookwarden/-/hookwarden-0.4.0.tgz"
  sha256 "${SHA_NM}"
  on_macos do
    depends_on "node"
  end
  on_linux do
    on_arm do
      url "https://github.com/Hookwarden/hookwarden/releases/download/v0.4.0/hookwarden-linux-arm64"
      sha256 "${SHA_LA}"
    end
    on_intel do
      url "https://github.com/Hookwarden/hookwarden/releases/download/v0.4.0/hookwarden-linux-x64"
      sha256 "${SHA_LX}"
    end
  end
end
EOF

# 4. Scoop manifest
cat > "$TMP/scoop.json" <<EOF
{
  "architecture": {
    "64bit": { "hash": "${SHA_W}" }
  }
}
EOF

# Test 1: matching set passes
echo "Test 1: matching SHAs across all channels MUST pass"
if ! bash "$CORE" "$TMP/checksums.txt" "$TMP/shim.json" "$TMP/formula.rb" "$TMP/scoop.json"; then
  echo "FAIL: matching set should have passed but core exited non-zero"
  exit 1
fi
echo "  PASS"

# Test 2: mutate a Linux-binary Homebrew SHA — expect FAIL
echo "Test 2: mutated Homebrew Linux-binary SHA MUST fail"
sed -i.bak "s|${SHA_LA}|$(printf '9%.0s' {1..64})|" "$TMP/formula.rb"
if bash "$CORE" "$TMP/checksums.txt" "$TMP/shim.json" "$TMP/formula.rb" "$TMP/scoop.json" 2>/dev/null; then
  echo "FAIL: mutated Homebrew Linux SHA should have triggered gate failure"
  exit 1
fi
echo "  PASS (gate correctly rejected mutated Homebrew Linux SHA)"
mv "$TMP/formula.rb.bak" "$TMP/formula.rb"

# Test 2b: mutate the npm-tarball SHA — must NOT fail (npm SHA is non-canonical)
echo "Test 2b: mutated Homebrew npm-tarball SHA must NOT fail (it's not in canonical set)"
sed -i.bak "s|${SHA_NM}|$(printf '9%.0s' {1..64})|" "$TMP/formula.rb"
if ! bash "$CORE" "$TMP/checksums.txt" "$TMP/shim.json" "$TMP/formula.rb" "$TMP/scoop.json" 2>/dev/null; then
  echo "FAIL: parity gate failed on npm-tarball SHA mutation, but npm SHA is intentionally non-canonical"
  bash "$CORE" "$TMP/checksums.txt" "$TMP/shim.json" "$TMP/formula.rb" "$TMP/scoop.json" || true
  exit 1
fi
echo "  PASS (gate correctly skipped the npm-tarball SHA)"
mv "$TMP/formula.rb.bak" "$TMP/formula.rb"

# Test 3: mutate one Scoop SHA — expect FAIL
echo "Test 3: mutated Scoop SHA MUST fail"
SCOOP_MUTATED=$(jq --arg new "$(printf 'f%.0s' {1..64})" '.architecture."64bit".hash = $new' "$TMP/scoop.json")
echo "$SCOOP_MUTATED" > "$TMP/scoop-mutated.json"
if bash "$CORE" "$TMP/checksums.txt" "$TMP/shim.json" "$TMP/formula.rb" "$TMP/scoop-mutated.json" 2>/dev/null; then
  echo "FAIL: mutated Scoop SHA should have triggered gate failure"
  exit 1
fi
echo "  PASS (gate correctly rejected mutated Scoop SHA)"

# Test 4: mutate one PyPI shim SHA — expect FAIL
echo "Test 4: mutated PyPI shim SHA MUST fail"
PYPI_MUTATED=$(jq --arg new "$(printf 'f%.0s' {1..64})" '."darwin-arm64" = $new' "$TMP/shim.json")
echo "$PYPI_MUTATED" > "$TMP/shim-mutated.json"
if bash "$CORE" "$TMP/checksums.txt" "$TMP/shim-mutated.json" "$TMP/formula.rb" "$TMP/scoop.json" 2>/dev/null; then
  echo "FAIL: mutated PyPI shim SHA should have triggered gate failure"
  exit 1
fi
echo "  PASS (gate correctly rejected mutated PyPI shim SHA)"

# Test 5: malformed SHA (not 64-hex) — expect FAIL
echo "Test 5: malformed (non-hex) SHA in Scoop MUST fail"
SCOOP_MALFORMED=$(jq '.architecture."64bit".hash = "not-a-valid-sha"' "$TMP/scoop.json")
echo "$SCOOP_MALFORMED" > "$TMP/scoop-malformed.json"
if bash "$CORE" "$TMP/checksums.txt" "$TMP/shim.json" "$TMP/formula.rb" "$TMP/scoop-malformed.json" 2>/dev/null; then
  echo "FAIL: malformed Scoop SHA should have triggered gate failure"
  exit 1
fi
echo "  PASS (gate correctly rejected malformed SHA)"

echo
echo "All 6 mutation tests passed — channel-parity gate correctly identifies divergence."
