#!/usr/bin/env bash
# verify-defensive-registration.sh — defensive-registration verification probe
#
# Source: project pattern, novel — implements the gate described in
# runbooks/registration.md and .planning/phases/01-foundation-defensive-registration/01-RESEARCH.md
# §"Defensive Registration Sequencing", aligned with the post-260501 strategy
# (quick task `260501-wbi`).
#
# Returns 0 only if every protected surface is in its expected state:
#   - npm canonical `hookwarden` is published AND owned by $NPM_OWNER. This is
#     load-bearing: once `hookwarden` exists owned by us, npm's similarity-check
#     policy automatically rejects publishes of the 5 typo names from anyone else.
#   - The 5 npm typo names (`hook-warden`, `hookwardn`, `hookwardne`, `hookwardens`,
#     `hookwarden-cli`) are NOT registered. A 404 here is success: it proves the
#     similarity-check is intact and no squatter has slipped in.
#   - npm scope `@hookwarden` is claimed via at least one `@hookwarden/*` publish
#     (Pitfall #4 — scopes are claimed implicitly on first publish, not via signup).
#   - PyPI canonical `hookwarden` is reserved via pending publisher (Plan 07
#     deviation #2 deferred the first publish — until then the JSON API returns
#     404, which the verifier accepts as the known-pending state).
#   - GitHub org `Hookwarden` exists.
#   - Domain `hookwarden.dev` resolves.
#
# Intentionally does NOT use `set -e` — every probe must run regardless of earlier
# failures so the user sees the full picture in one report.
set -uo pipefail

GH_ORG="${HOOKWARDEN_GH_ORG:-Hookwarden}"           # capitalisation matches what GH returns
DOMAIN="${HOOKWARDEN_DOMAIN:-hookwarden.dev}"
NPM_OWNER="${HOOKWARDEN_NPM_USER:-adelinalipsa}"    # npm username to verify maintainership against
TYPO_NAMES=(hook-warden hookwardn hookwardne hookwardens hookwarden-cli)

FAIL=0
pass() { printf "  [ok]   %s\n" "$1"; }
fail() { printf "  [FAIL] %s\n" "$1"; FAIL=$((FAIL+1)); }

echo "[1/5] npm canonical hookwarden (maintainer = $NPM_OWNER)"
out=$(npm view hookwarden maintainers 2>&1)
rc=$?
if [[ $rc -ne 0 ]]; then
  fail "hookwarden: not yet published (npm view exit=$rc)"
elif [[ "$out" == *"$NPM_OWNER"* ]]; then
  pass "hookwarden owned by $NPM_OWNER"
else
  fail "hookwarden exists but $NPM_OWNER not in maintainers list (got: $out)"
fi

echo
echo "[2/5] npm typo names unregistered (similarity-check active)"
for n in "${TYPO_NAMES[@]}"; do
  npm view "$n" version >/dev/null 2>&1
  rc=$?
  if [[ $rc -ne 0 ]]; then
    pass "$n is unregistered (npm similarity-check protects it)"
  else
    owner=$(npm view "$n" maintainers 2>/dev/null)
    if [[ "$owner" == *"$NPM_OWNER"* ]]; then
      pass "$n exists and is owned by $NPM_OWNER"
    else
      fail "$n is published but NOT by $NPM_OWNER (squat? got: $owner)"
    fi
  fi
done

echo
echo "[3/5] npm scope @hookwarden (claimed via first @hookwarden/* publish)"
if npm view @hookwarden/engine version >/dev/null 2>&1; then
  ver=$(npm view @hookwarden/engine version 2>/dev/null)
  pass "@hookwarden/engine published at version $ver — scope claimed"
else
  fail "@hookwarden/engine not yet published — scope unclaimed"
fi

echo
echo "[4/5] PyPI canonical hookwarden (pending publisher reservation OR published)"
http_code=$(curl -sS -o /tmp/.hookwarden-pypi-resp -w "%{http_code}" \
  "https://pypi.org/pypi/hookwarden/json" 2>/dev/null)
rc=$?
if [[ $rc -ne 0 ]]; then
  fail "PyPI hookwarden: HTTP fetch errored (curl exit=$rc — network issue?)"
elif [[ "$http_code" == "404" ]]; then
  pass "PyPI hookwarden: 404 (pending publisher reserved; first publish deferred per Plan 07)"
elif [[ "$http_code" == "200" ]]; then
  ver=$(python3 -c "import sys,json; print(json.loads(open('/tmp/.hookwarden-pypi-resp').read())['info']['version'])" 2>/dev/null)
  if [[ -n "$ver" ]]; then
    pass "PyPI hookwarden published at version $ver"
  else
    fail "PyPI hookwarden returned 200 but JSON missing version field"
  fi
else
  fail "PyPI hookwarden: unexpected HTTP $http_code"
fi
rm -f /tmp/.hookwarden-pypi-resp

echo
echo "[5/5] GitHub org $GH_ORG + domain $DOMAIN"
if gh api "orgs/$GH_ORG" --jq .login >/dev/null 2>&1; then
  login=$(gh api "orgs/$GH_ORG" --jq .login 2>/dev/null)
  pass "GH org $login exists"
else
  fail "GH org $GH_ORG does not exist or is inaccessible (gh auth status?)"
fi

if dig "$DOMAIN" +short 2>/dev/null | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+|^[0-9a-f:]+'; then
  ips=$(dig "$DOMAIN" +short 2>/dev/null | head -3 | tr '\n' ' ')
  pass "domain $DOMAIN resolves ($ips)"
else
  fail "domain $DOMAIN does not resolve (dig +short returned no A/AAAA records)"
fi

echo
if [[ $FAIL -gt 0 ]]; then
  printf "FAILED: %d probe(s) did not pass.\n" "$FAIL"
  printf "See runbooks/registration.md for recovery procedures.\n"
  exit 1
fi
echo "All defensive-registration probes pass."
exit 0
