#!/usr/bin/env bash
# scripts/release/verify-channel-parity-core.sh
# Pure comparison; no network. Inputs are file paths.
#
# Usage: verify-channel-parity-core.sh <checksums.txt> <pypi-checksums.json> <formula.rb> <scoop.json>
# Exit 0 = all channels match canonical; exit 1 = divergence.
set -euo pipefail

CANONICAL_FILE="${1:?canonical checksums.txt path required}"
PYPI_FILE="${2:?PyPI shim _data/checksums.json path required}"
FORMULA_FILE="${3:?Formula/hookwarden.rb path required}"
SCOOP_FILE="${4:?bucket/hookwarden.json path required}"

# Canonical set as a plain array of SHA values (membership-only check; the
# filename→SHA mapping isn't needed for divergence detection). Plain arrays
# work on bash 3.2+ — `declare -A` would force bash 4+, which macOS defaults
# don't ship.
CANONICAL_VALUES=()
while read -r sha _file; do
  [[ -z "$sha" ]] && continue
  CANONICAL_VALUES+=("$sha")
done < "$CANONICAL_FILE"

if [[ ${#CANONICAL_VALUES[@]} -eq 0 ]]; then
  echo "FAIL: canonical checksums.txt empty or unparseable" >&2
  exit 1
fi

PYPI_PAIRS=$(jq -r 'to_entries[] | "\(.value) \(.key)"' "$PYPI_FILE")
# Extract only the sha256 lines paired with a GH-release URL (Linux binaries).
# The formula's top-level url+sha256 is the npm tarball, which is not in the
# canonical checksums.txt — its integrity is verified through the npm
# registry's own publish chain + bump-homebrew.sh's own download-and-pin step.
HOMEBREW_SHAS=$(awk '
  /url "/ {
    url_is_gh_release = ($0 ~ /releases\/download\//)
    next
  }
  /sha256 "[a-f0-9]{64}"/ && url_is_gh_release {
    match($0, /[a-f0-9]{64}/)
    print substr($0, RSTART, RLENGTH)
    url_is_gh_release = 0
  }
' "$FORMULA_FILE")
SCOOP_SHAS=$(jq -r '.architecture | to_entries[] | .value.hash' "$SCOOP_FILE")

fail=0
divergence=()
assert_in_canonical() {
  local needle=$1
  local source_label=$2
  if [[ ! "$needle" =~ ^[a-f0-9]{64}$ ]]; then
    divergence+=("MALFORMED ($source_label): $needle is not 64-hex")
    fail=1
    return
  fi
  for v in "${CANONICAL_VALUES[@]}"; do
    if [[ "$v" == "$needle" ]]; then return; fi
  done
  divergence+=("DIVERGED ($source_label): SHA $needle not in canonical set")
  fail=1
}

while IFS=' ' read -r sha key; do
  [[ -z "$sha" ]] && continue
  assert_in_canonical "$sha" "PyPI shim ($key)"
done <<<"$PYPI_PAIRS"

while IFS= read -r sha; do
  [[ -z "$sha" ]] && continue
  assert_in_canonical "$sha" "Homebrew formula"
done <<<"$HOMEBREW_SHAS"

while IFS= read -r sha; do
  [[ -z "$sha" ]] && continue
  assert_in_canonical "$sha" "Scoop manifest"
done <<<"$SCOOP_SHAS"

if (( fail )); then
  echo
  echo "CHANNEL-PARITY core check FAILED:"
  for line in "${divergence[@]}"; do echo "  $line"; done
  exit 1
fi
echo "Channel-parity core check PASSED."
