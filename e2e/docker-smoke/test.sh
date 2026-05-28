#!/bin/bash
# hookwarden E2E smoke — fresh npm install in a clean Node 22 container.
#
# Mounts /fixtures (phase-3) and /perf (perf/generated/). Asserts the
# documented expected output for each known-contract fixture, and
# verifies the remaining fixtures complete without crashing.
#
# Distinct from e2e/phase-3.test.ts (in-process vitest). This proves
# the PUBLISHED npm artefact works in a clean Node 22 + no source tree,
# which the in-process test cannot.
#
# Pass HW_VERSION=latest as an env var to test the latest published
# version instead of the pinned default.
set -u

HW_VERSION="${HW_VERSION:-0.5.5}"

PASS=0
FAIL=0
SKIP=0
FAILED_NAMES=()

note() { printf "\033[36m▸\033[0m %s\n" "$*"; }
ok()   { printf "\033[32m✓\033[0m %s\n" "$*"; PASS=$((PASS+1)); }
fail() { printf "\033[31m✗\033[0m %s\n" "$*"; FAIL=$((FAIL+1)); FAILED_NAMES+=("$*"); }
skip() { printf "\033[33m·\033[0m %s\n" "$*"; SKIP=$((SKIP+1)); }

# ---------- stage 0: install hookwarden from npm ------------------------
note "stage 0: installing hookwarden@${HW_VERSION} from npm registry"
cd /test
echo '{"name":"e2e-host","version":"0.0.0","private":true}' > package.json
if ! npm install "hookwarden@${HW_VERSION}" --silent --no-fund --no-audit 2>&1 | tail -3; then
  fail "stage 0 install failed"; exit 1
fi
HW="./node_modules/.bin/hookwarden"
[ -x "$HW" ] || { fail "stage 0 binary missing at $HW"; exit 1; }
ok "stage 0 install — $($HW --version 2>&1 | head -1)"

# assert_scan LABEL EXPECT_EXIT FIXTURE_PATH [--flags...] SUBSTRINGS...
# EXPECT_EXIT may be a number or "any" to skip the exit-code check.
assert_scan() {
  local label="$1" expect_exit="$2"; shift 2
  local fpath="$1"; shift
  local extra=()
  while [[ "${1:-}" == --* ]]; do extra+=("$1"); shift; done
  local expects=("$@")
  local out rc errs=()
  out=$("$HW" scan "$fpath" "${extra[@]}" 2>&1) && rc=0 || rc=$?
  if [[ "$expect_exit" != "any" && "$rc" != "$expect_exit" ]]; then
    errs+=("exit: want $expect_exit got $rc")
  fi
  for s in "${expects[@]}"; do
    grep -qF "$s" <<<"$out" || errs+=("missing: $s")
  done
  if [[ ${#errs[@]} -eq 0 ]]; then ok "$label"; else
    fail "$label"
    for e in "${errs[@]}"; do printf "   • %s\n" "$e"; done
    head -25 <<<"$out" | sed 's/^/   /'
  fi
}

# ---------- stage 1: phase-3 fixtures with documented expected output --
note "stage 1: phase-3 fixtures (10 cases)"

assert_scan "canonical-stripe-bug → critical/not-verified" 1 \
  /fixtures/canonical-stripe-bug \
  "× critical" "stripe/missing-signature-verification" "not-verified" \
  "always verify events" "docs › https://stripe.com/docs/webhooks"

assert_scan "stripe-construct-event-happy-path → verified" 0 \
  /fixtures/stripe-construct-event-happy-path \
  "verified" "stripe/library-verified"

assert_scan "python-flask-happy-path → verified" 0 \
  /fixtures/python-flask-happy-path \
  "verified" "stripe/library-verified"

# seeded-secret with --include-tests: the fixture is a webhook handler with
# a hardcoded whsec_* AND no signature verification, so the scanner correctly
# fires BOTH stripe/hardcoded-secret-prefix (info) AND
# stripe/missing-signature-verification (critical) — exit 1 is the right
# behaviour. We assert substrings only, not exit code.
assert_scan "seeded-secret → info + critical (both rules fire)" any \
  /fixtures/seeded-secret --include-tests \
  "stripe/hardcoded-secret-prefix" "i info" "not-verified"

assert_scan "stripe-catch-swallow-known-fn → known FN (verified)" 0 \
  /fixtures/stripe-catch-swallow-known-fn \
  "stripe/library-verified" "verified"

assert_scan "stripe-inline-middleware-verify → scan completes" 0 \
  /fixtures/stripe-inline-middleware-verify \
  "stripe/"

assert_scan "python-flask-bug → exit 1 (bug detected)" 1 \
  /fixtures/python-flask-bug \
  "stripe/" "not-verified"

assert_scan "php-laravel-bug → exit 1, PHP rule" 1 \
  /fixtures/php-laravel-bug \
  "not-verified"

assert_scan "php-vanilla-bug → exit 1, PHP rule" 1 \
  /fixtures/php-vanilla-bug \
  "not-verified"

# php-edge-cases: no README; smoke-only (must complete, any exit ≤ 1).
note "php-edge-cases: smoke-only"
if "$HW" scan /fixtures/php-edge-cases >/dev/null 2>&1; then rc=0; else rc=$?; fi
if [[ $rc -le 1 ]]; then ok "php-edge-cases → completed (exit $rc)"
else fail "php-edge-cases crashed (exit $rc)"; fi

# ---------- stage 2: inventory subcommand -------------------------------
note "stage 2: inventory subcommand contract"
INV_OUT=$("$HW" inventory /fixtures 2>&1) && INV_RC=0 || INV_RC=$?
errs=()
[[ "$INV_RC" == "0" ]] || errs+=("inventory exit: want 0 got $INV_RC")
for s in framework route_pattern provider state "file:line" "/webhooks/stripe"; do
  grep -qF "$s" <<<"$INV_OUT" || errs+=("inventory missing: $s")
done
if [[ ${#errs[@]} -eq 0 ]]; then ok "inventory subcommand"
else fail "inventory subcommand"
  for e in "${errs[@]}"; do printf "   • %s\n" "$e"; done
fi

# ---------- stage 3: output format contracts (json + sarif) -------------
note "stage 3: --format json + sarif on canonical-stripe-bug"

JSON_OUT=$("$HW" scan /fixtures/canonical-stripe-bug --format json 2>/dev/null) || true
# Contract: the JSON output is schema v1 with .scan.findings[].rule_id and
# the canonical-stripe-bug fixture surfaces stripe/missing-signature-verification
# somewhere in the findings list. Don't pin the position — finding-order is an
# engine implementation detail and the fixture also legitimately fires other
# stripe rules (e.g. stripe/express-middleware-ordering).
if echo "$JSON_OUT" | jq -e '.scan.findings | length > 0' >/dev/null 2>&1; then
  if echo "$JSON_OUT" \
    | jq -e '[.scan.findings[].rule_id] | index("stripe/missing-signature-verification")' \
      >/dev/null 2>&1; then
    ok "--format json → schema v1 includes stripe/missing-signature-verification"
  else
    fail "--format json → stripe/missing-signature-verification not in findings"
    echo "$JSON_OUT" | jq -r '.scan.findings[].rule_id' 2>/dev/null \
      | head -5 | sed 's/^/   got rule_id: /'
  fi
else
  fail "--format json → JSON shape unexpected"
  echo "$JSON_OUT" | head -10 | sed 's/^/   /'
fi

SARIF_OUT=$("$HW" scan /fixtures/canonical-stripe-bug --format sarif 2>/dev/null) || true
if echo "$SARIF_OUT" | jq -e '.version == "2.1.0" and (.runs | length > 0)' >/dev/null 2>&1; then
  ok "--format sarif → SARIF 2.1.0 with runs[]"
else
  fail "--format sarif → not valid SARIF 2.1.0"
fi

# ---------- stage 4: perf fixtures (8 framework × language apps) -------
note "stage 4: perf/generated apps (smoke — must complete without crash)"

for app in /perf/express-app /perf/fastify-app /perf/hono-app /perf/nextjs-app \
           /perf/flask-app /perf/fastapi-app /perf/django-app /perf/php; do
  name=$(basename "$app")
  [ -d "$app" ] || { skip "perf/$name (dir absent)"; continue; }
  t0=$(date +%s)
  if "$HW" scan "$app" >/tmp/perf.out 2>&1; then rc=0; else rc=$?; fi
  dt=$(($(date +%s) - t0))
  if [[ $rc -le 1 ]]; then
    ok "perf/$name completed in ${dt}s (exit $rc)"
  else
    fail "perf/$name CRASHED (exit $rc)"
    head -20 /tmp/perf.out | sed 's/^/   /'
  fi
done

# ---------- summary -----------------------------------------------------
echo ""
echo "════════════════════════════════════════════════════════════════════════"
printf "  \033[32m%d passed\033[0m · \033[31m%d failed\033[0m · \033[33m%d skipped\033[0m\n" "$PASS" "$FAIL" "$SKIP"
echo "════════════════════════════════════════════════════════════════════════"
if [[ $FAIL -gt 0 ]]; then
  echo ""; echo "Failed cases:"
  for n in "${FAILED_NAMES[@]}"; do printf "  • %s\n" "$n"; done
  exit 1
fi
exit 0
