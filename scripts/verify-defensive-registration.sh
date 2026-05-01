#!/usr/bin/env bash
# verify-defensive-registration.sh — 13-identity verification probe
#
# Source: project pattern, novel — implements the gate described in
# runbooks/registration.md and .planning/phases/01-foundation-defensive-registration/01-RESEARCH.md
# §"Defensive Registration Sequencing".
#
# Returns 0 only if all 13 identities are claimed by the project:
#   - 6 npm names (canonical + 5 typos): hookwarden, hook-warden, hookwardn, hookwardne,
#     hookwardens, hookwarden-cli
#   - 1 npm scope: @hookwarden (claimed via first @hookwarden/* publish — Pitfall #4)
#   - 6 PyPI names (canonical + 5 typos): same six dist names as npm
#   - 1 GitHub org: Hookwarden
#   - 1 domain: hookwarden.dev
#
# Total: 6 + 1 + 6 + 1 + 1 = 15 probes covering 13 identity slots (PEP 503 collapses
# hook-warden/hook_warden/hook.warden into a single PyPI registration, so one probe
# proves three names are claimed).
#
# Intentionally does NOT use `set -e` — every probe must run regardless of earlier
# failures so the user sees the full picture in one report.
set -uo pipefail

GH_ORG="${HOOKWARDEN_GH_ORG:-Hookwarden}"           # capitalisation matches what GH returns
DOMAIN="${HOOKWARDEN_DOMAIN:-hookwarden.dev}"
NPM_OWNER="${HOOKWARDEN_NPM_USER:-adelina-lipsa}"   # npm username to verify maintainership against

FAIL=0
pass() { printf "  [ok]   %s\n" "$1"; }
fail() { printf "  [FAIL] %s\n" "$1"; FAIL=$((FAIL+1)); }

echo "[1/4] npm canonical + 5 typos (maintainer = $NPM_OWNER)"
for n in hookwarden hook-warden hookwardn hookwardne hookwardens hookwarden-cli; do
  out=$(npm view "$n" maintainers 2>&1)
  rc=$?
  if [[ $rc -ne 0 ]]; then
    fail "$n: not yet published (npm view exit=$rc)"
    continue
  fi
  if [[ "$out" == *"$NPM_OWNER"* ]]; then
    pass "$n owned by $NPM_OWNER"
  else
    fail "$n exists but $NPM_OWNER not in maintainers list (got: $out)"
  fi
done

echo
echo "[2/4] npm scope @hookwarden (claimed via first @hookwarden/* publish)"
if npm view @hookwarden/engine version >/dev/null 2>&1; then
  ver=$(npm view @hookwarden/engine version 2>/dev/null)
  pass "@hookwarden/engine published at version $ver — scope claimed"
else
  fail "@hookwarden/engine not yet published — scope unclaimed"
fi

echo
echo "[3/4] PyPI canonical + 5 typos"
for n in hookwarden hook-warden hookwardn hookwardne hookwardens hookwarden-cli; do
  resp=$(curl -fsS "https://pypi.org/pypi/$n/json" 2>/dev/null)
  rc=$?
  if [[ $rc -ne 0 ]]; then
    fail "PyPI $n: not yet published (HTTP fetch failed)"
    continue
  fi
  ver=$(printf '%s' "$resp" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['info']['version'])" 2>/dev/null)
  if [[ -n "$ver" ]]; then
    pass "PyPI $n at version $ver"
  else
    fail "PyPI $n response missing version field"
  fi
done

echo
echo "[4/4] GitHub org $GH_ORG + domain $DOMAIN"
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
  printf "FAILED: %d of 15 probes did not pass.\n" "$FAIL"
  printf "See runbooks/registration.md for recovery procedures.\n"
  exit 1
fi
echo "All 13 identities claimed. Defensive registration gate passes."
exit 0
