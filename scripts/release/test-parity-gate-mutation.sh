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

# ─── Adversarial + edge-case coverage (Tests 6-15) ──────────────────────────
# The parity gate is the last line of defence against supply-chain divergence
# between Homebrew, Scoop, and PyPI shim. Each negative test below maps to a
# real attack/failure scenario a senior DevOps would expect us to catch.

# ---- Test 6: reordered formula sha256 lines → membership-check still passes ----
echo "Test 6: formula with reordered Linux SHAs (x64 before arm) → membership-check still passes"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_DA}  hookwarden-darwin-arm64
${SHA_DX}  hookwarden-darwin-x64
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
${SHA_W}  hookwarden-windows-x64.exe
EOF
cat > "$TMP/shim.json" <<EOF
{"darwin-arm64": "${SHA_DA}", "darwin-x64": "${SHA_DX}", "linux-arm64": "${SHA_LA}", "linux-x64": "${SHA_LX}", "windows-x64": "${SHA_W}"}
EOF
cat > "$TMP/formula.rb" <<EOF
class Hookwarden < Formula
  url "https://registry.npmjs.org/hookwarden/-/hookwarden-0.4.0.tgz"
  sha256 "${SHA_NM}"
  on_linux do
    on_intel do
      url "https://github.com/Hookwarden/hookwarden/releases/download/v0.4.0/hookwarden-linux-x64"
      sha256 "${SHA_LX}"
    end
    on_arm do
      url "https://github.com/Hookwarden/hookwarden/releases/download/v0.4.0/hookwarden-linux-arm64"
      sha256 "${SHA_LA}"
    end
  end
end
EOF
cat > "$TMP/scoop.json" <<EOF
{"architecture": {"64bit": { "hash": "${SHA_W}" }}}
EOF
if ! bash "$CORE" "$TMP/checksums.txt" "$TMP/shim.json" "$TMP/formula.rb" "$TMP/scoop.json" >/dev/null 2>&1; then
  echo "FAIL: reordered (but still membership-valid) SHAs should have passed"
  bash "$CORE" "$TMP/checksums.txt" "$TMP/shim.json" "$TMP/formula.rb" "$TMP/scoop.json"
  exit 1
fi
echo "  PASS (gate uses membership semantics, not positional)"

# ---- Test 7: hypothetical regrowth — on_macos block with its own GH url+sha
# (this would attack the parity gate's assumption that macOS uses npm only). ----
echo "Test 7: hypothetical on_macos { url releases/download/... sha256 X } regrowth → SHA must be parity-checked"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_DA}  hookwarden-darwin-arm64
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
EOF
cat > "$TMP/shim.json" <<EOF
{"linux-arm64": "${SHA_LA}", "linux-x64": "${SHA_LX}"}
EOF
SHA_ATTACKER=$(printf '7%.0s' {1..64})  # NOT in canonical
cat > "$TMP/formula.rb" <<EOF
class Hookwarden < Formula
  url "https://registry.npmjs.org/hookwarden/-/hookwarden-0.4.0.tgz"
  sha256 "${SHA_NM}"
  on_macos do
    url "https://github.com/Hookwarden/hookwarden/releases/download/v0.4.0/hookwarden-darwin-arm64"
    sha256 "${SHA_ATTACKER}"
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
cat > "$TMP/scoop.json" <<EOF
{"architecture": {"64bit": { "hash": "${SHA_W}" }}}
EOF
# Add canonical SHA_W so scoop passes; we're testing the on_macos regrowth specifically.
echo "${SHA_W}  hookwarden-windows-x64.exe" >> "$TMP/checksums.txt"
if bash "$CORE" "$TMP/checksums.txt" "$TMP/shim.json" "$TMP/formula.rb" "$TMP/scoop.json" >/dev/null 2>&1; then
  echo "FAIL: attacker SHA inside on_macos url block should have been caught by parity gate"
  cat "$TMP/formula.rb"
  exit 1
fi
echo "  PASS (any sha256 paired with a releases/download URL is parity-checked, including on_macos regrowths)"

# ---- Test 8: missing CHECKSUMS file → gate fails fast ----
echo "Test 8: missing CHECKSUMS file → gate MUST fail fast"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/shim.json" <<EOF
{"linux-arm64": "${SHA_LA}"}
EOF
cat > "$TMP/formula.rb" <<EOF
class Hookwarden < Formula
  on_linux do on_arm do url "https://github.com/Hookwarden/hookwarden/releases/download/v0.4.0/hookwarden-linux-arm64"; sha256 "${SHA_LA}" end end
end
EOF
cat > "$TMP/scoop.json" <<EOF
{"architecture": {"64bit": {"hash": "${SHA_W}"}}}
EOF
if bash "$CORE" "$TMP/does-not-exist.txt" "$TMP/shim.json" "$TMP/formula.rb" "$TMP/scoop.json" 2>/dev/null; then
  echo "FAIL: missing CHECKSUMS file should have triggered gate failure"
  exit 1
fi
echo "  PASS"

# ---- Test 9: malformed PyPI shim JSON → jq error propagates as gate failure ----
echo "Test 9: malformed PyPI shim JSON → gate MUST fail (jq parse error)"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
${SHA_W}  hookwarden-windows-x64.exe
EOF
echo "not valid json {" > "$TMP/shim.json"
cat > "$TMP/formula.rb" <<EOF
class Hookwarden < Formula
  on_linux do
    on_arm do url "https://github.com/Hookwarden/hookwarden/releases/download/v0.4.0/hookwarden-linux-arm64"; sha256 "${SHA_LA}" end
    on_intel do url "https://github.com/Hookwarden/hookwarden/releases/download/v0.4.0/hookwarden-linux-x64"; sha256 "${SHA_LX}" end
  end
end
EOF
cat > "$TMP/scoop.json" <<EOF
{"architecture": {"64bit": {"hash": "${SHA_W}"}}}
EOF
if bash "$CORE" "$TMP/checksums.txt" "$TMP/shim.json" "$TMP/formula.rb" "$TMP/scoop.json" 2>/dev/null; then
  echo "FAIL: malformed PyPI shim JSON should have caused gate failure"
  exit 1
fi
echo "  PASS"

# ---- Test 10: malformed Scoop JSON → jq error propagates ----
echo "Test 10: malformed Scoop manifest JSON → gate MUST fail"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
${SHA_W}  hookwarden-windows-x64.exe
EOF
cat > "$TMP/shim.json" <<EOF
{"linux-arm64": "${SHA_LA}", "linux-x64": "${SHA_LX}"}
EOF
cat > "$TMP/formula.rb" <<EOF
class Hookwarden < Formula
  on_linux do
    on_arm do url "https://github.com/Hookwarden/hookwarden/releases/download/v0.4.0/hookwarden-linux-arm64"; sha256 "${SHA_LA}" end
    on_intel do url "https://github.com/Hookwarden/hookwarden/releases/download/v0.4.0/hookwarden-linux-x64"; sha256 "${SHA_LX}" end
  end
end
EOF
echo "broken {" > "$TMP/scoop.json"
if bash "$CORE" "$TMP/checksums.txt" "$TMP/shim.json" "$TMP/formula.rb" "$TMP/scoop.json" 2>/dev/null; then
  echo "FAIL: malformed Scoop JSON should have caused gate failure"
  exit 1
fi
echo "  PASS"

# ---- Test 11: empty canonical checksums.txt → gate fails fast ----
echo "Test 11: empty canonical checksums.txt → gate MUST fail (no membership to check against)"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
: > "$TMP/checksums.txt"
cat > "$TMP/shim.json" <<EOF
{"linux-arm64": "${SHA_LA}"}
EOF
cat > "$TMP/formula.rb" <<EOF
class Hookwarden < Formula
  on_linux do on_arm do url "https://github.com/Hookwarden/hookwarden/releases/download/v0.4.0/hookwarden-linux-arm64"; sha256 "${SHA_LA}" end end
end
EOF
cat > "$TMP/scoop.json" <<EOF
{"architecture": {"64bit": {"hash": "${SHA_W}"}}}
EOF
if bash "$CORE" "$TMP/checksums.txt" "$TMP/shim.json" "$TMP/formula.rb" "$TMP/scoop.json" 2>/dev/null; then
  echo "FAIL: empty canonical checksums.txt should have caused gate failure"
  exit 1
fi
echo "  PASS"

# ---- Test 12: 63-char truncated SHA in Scoop → regex validation rejects ----
echo "Test 12: 63-char truncated SHA in Scoop (off-by-one attacker) → regex MUST reject"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
${SHA_W}  hookwarden-windows-x64.exe
EOF
cat > "$TMP/shim.json" <<EOF
{"linux-arm64": "${SHA_LA}", "linux-x64": "${SHA_LX}"}
EOF
cat > "$TMP/formula.rb" <<EOF
class Hookwarden < Formula
  on_linux do
    on_arm do url "https://github.com/Hookwarden/hookwarden/releases/download/v0.4.0/hookwarden-linux-arm64"; sha256 "${SHA_LA}" end
    on_intel do url "https://github.com/Hookwarden/hookwarden/releases/download/v0.4.0/hookwarden-linux-x64"; sha256 "${SHA_LX}" end
  end
end
EOF
SHA_TRUNC=$(printf 'a%.0s' {1..63})  # 63 hex chars, off by one
cat > "$TMP/scoop.json" <<EOF
{"architecture": {"64bit": {"hash": "${SHA_TRUNC}"}}}
EOF
if bash "$CORE" "$TMP/checksums.txt" "$TMP/shim.json" "$TMP/formula.rb" "$TMP/scoop.json" 2>/dev/null; then
  echo "FAIL: 63-char truncated SHA should have failed the 64-hex regex"
  exit 1
fi
echo "  PASS (off-by-one length mutation caught)"

# ---- Test 13: multi-channel cross-divergence — gate identifies ALL diverging channels ----
echo "Test 13: 2 channels diverged from canonical → gate reports BOTH"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
${SHA_W}  hookwarden-windows-x64.exe
EOF
SHA_BAD=$(printf '9%.0s' {1..64})
# Both PyPI shim and Scoop mutated, Homebrew clean
cat > "$TMP/shim.json" <<EOF
{"linux-arm64": "${SHA_BAD}", "linux-x64": "${SHA_LX}"}
EOF
cat > "$TMP/formula.rb" <<EOF
class Hookwarden < Formula
  on_linux do
    on_arm do url "https://github.com/Hookwarden/hookwarden/releases/download/v0.4.0/hookwarden-linux-arm64"; sha256 "${SHA_LA}" end
    on_intel do url "https://github.com/Hookwarden/hookwarden/releases/download/v0.4.0/hookwarden-linux-x64"; sha256 "${SHA_LX}" end
  end
end
EOF
cat > "$TMP/scoop.json" <<EOF
{"architecture": {"64bit": {"hash": "${SHA_BAD}"}}}
EOF
gate_out=$(bash "$CORE" "$TMP/checksums.txt" "$TMP/shim.json" "$TMP/formula.rb" "$TMP/scoop.json" 2>&1 || true)
# Both divergences must be reported (PyPI shim + Scoop)
echo "$gate_out" | grep -q "PyPI shim" || { echo "FAIL: PyPI shim divergence not reported"; echo "$gate_out"; exit 1; }
echo "$gate_out" | grep -q "Scoop manifest" || { echo "FAIL: Scoop divergence not reported"; echo "$gate_out"; exit 1; }
echo "  PASS (gate reports all diverging channels, not just the first)"

# ---- Test 14: formula path doesn't exist → fails fast ----
echo "Test 14: missing FORMULA file → gate MUST fail"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
EOF
cat > "$TMP/shim.json" <<EOF
{"linux-arm64": "${SHA_LA}"}
EOF
cat > "$TMP/scoop.json" <<EOF
{"architecture": {"64bit": {"hash": "${SHA_W}"}}}
EOF
if bash "$CORE" "$TMP/checksums.txt" "$TMP/shim.json" "$TMP/does-not-exist.rb" "$TMP/scoop.json" 2>/dev/null; then
  echo "FAIL: missing FORMULA file should have failed"
  exit 1
fi
echo "  PASS"

# ---- Test 15: Scoop manifest with multiple architectures (32bit + 64bit + arm64) ----
echo "Test 15: Scoop manifest with multiple architectures → all hashes parity-checked"
rm -rf "$TMP" && TMP=$(mktemp -d) && trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/checksums.txt" <<EOF
${SHA_LA}  hookwarden-linux-arm64
${SHA_LX}  hookwarden-linux-x64
${SHA_W}  hookwarden-windows-x64.exe
EOF
cat > "$TMP/shim.json" <<EOF
{"linux-arm64": "${SHA_LA}", "linux-x64": "${SHA_LX}"}
EOF
cat > "$TMP/formula.rb" <<EOF
class Hookwarden < Formula
  on_linux do
    on_arm do url "https://github.com/Hookwarden/hookwarden/releases/download/v0.4.0/hookwarden-linux-arm64"; sha256 "${SHA_LA}" end
    on_intel do url "https://github.com/Hookwarden/hookwarden/releases/download/v0.4.0/hookwarden-linux-x64"; sha256 "${SHA_LX}" end
  end
end
EOF
# 64bit valid, arm64 invalid (not in canonical) — gate must catch the arm64 mutation
SHA_BAD=$(printf '8%.0s' {1..64})
cat > "$TMP/scoop.json" <<EOF
{"architecture": {"64bit": {"hash": "${SHA_W}"}, "arm64": {"hash": "${SHA_BAD}"}}}
EOF
if bash "$CORE" "$TMP/checksums.txt" "$TMP/shim.json" "$TMP/formula.rb" "$TMP/scoop.json" 2>/dev/null; then
  echo "FAIL: Scoop multi-arch with one bad hash should have failed"
  exit 1
fi
echo "  PASS (every Scoop architecture hash is checked, not just 64bit)"

echo
echo "All 15 mutation tests passed — channel-parity gate correctly identifies divergence."
