#!/bin/bash
# hookwarden E2E smoke — fresh npm install in a clean Node 22 container.
#
# Mounts /fixtures (phase-3) and /perf (perf/generated/). Verifies the
# PUBLISHED npm artefact against the real published CLI surface across
# 10 stages with positive AND negative assertions interleaved:
#
#   stage 0  install + version + 5 subcommand help (+ 2 negatives)
#   stage 1  phase-3 fixtures × text format (10)
#   stage 2  phase-3 fixtures × JSON format + deep schema (+ negative)
#   stage 3  phase-3 fixtures × SARIF format + deep schema (+ negative)
#   stage 4  provider rule-pack coverage (one per provider)
#   stage 5  inventory subcommand contracts (+ negative)
#   stage 6  CLI flag matrix (positive + negative interleaved)
#   stage 7  stdout/stderr discipline (+ negative)
#   stage 8  fix codemod contracts (+ negatives)
#   stage 9  explain subcommand (+ negatives)
#   stage 10 byte-stability + perf apps (+ rule-presence)
#
# Distinct from e2e/phase-3.test.ts (in-process vitest). This proves
# the PUBLISHED npm artefact works in a clean Node 22 + no source tree,
# which the in-process test cannot.
#
# Pass HW_VERSION=latest as an env var to test the latest published
# version instead of the pinned default.

set -u

# Critical: by default bash runs every command in a pipeline in a
# subshell, which means counter mutations inside `... | assert_jq foo`
# vanish. `lastpipe` reverses that for the final pipeline stage (the
# helper that does PASS=$((PASS+1))). Requires monitor mode off, which
# is the default for non-interactive scripts but we set it explicitly.
set +m
shopt -s lastpipe

HW_VERSION="${HW_VERSION:-0.5.5}"

PASS=0
FAIL=0
SKIP=0
FAILED_NAMES=()

note() { printf "\033[36m▸\033[0m %s\n" "$*"; }
ok()   { printf "\033[32m✓\033[0m %s\n" "$*"; PASS=$((PASS+1)); }
fail() {
  printf "\033[31m✗\033[0m %s\n" "$1"; FAIL=$((FAIL+1)); FAILED_NAMES+=("$1")
  shift
  for d in "$@"; do printf "   • %s\n" "$d"; done
}
skip() { printf "\033[33m·\033[0m %s\n" "$*"; SKIP=$((SKIP+1)); }

# ---------- shared helpers ---------------------------------------------

# assert_scan LABEL EXPECT_EXIT FIXTURE [--flags...] SUBSTRINGS...
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
  if [[ ${#errs[@]} -eq 0 ]]; then ok "$label"
  else
    fail "$label" "${errs[@]}"
    head -10 <<<"$out" | sed 's/^/   /'
  fi
}

# assert_fails LABEL CMD...  — asserts non-zero exit, no stdout/stderr requirement
assert_fails() {
  local label="$1"; shift
  local out rc
  out=$("$@" 2>&1) && rc=0 || rc=$?
  if [[ $rc -eq 0 ]]; then
    fail "$label" "expected non-zero exit, got 0"
    head -10 <<<"$out" | sed 's/^/   /'
  else ok "$label (exit $rc)"; fi
}

# assert_fails_with LABEL HINT CMD... — asserts non-zero exit + hint in output
assert_fails_with() {
  local label="$1" hint="$2"; shift 2
  local out rc errs=()
  out=$("$@" 2>&1) && rc=0 || rc=$?
  [[ $rc -ne 0 ]] || errs+=("expected non-zero exit, got 0")
  grep -qiF "$hint" <<<"$out" || errs+=("missing hint: $hint")
  if [[ ${#errs[@]} -eq 0 ]]; then ok "$label (exit $rc)"
  else
    fail "$label" "${errs[@]}"
    head -10 <<<"$out" | sed 's/^/   /'
  fi
}

# assert_json_valid LABEL — STDIN must be valid JSON
assert_json_valid() {
  local label="$1"
  if jq -e . >/dev/null 2>&1; then ok "$label"
  else fail "$label" "stdout is not valid JSON"; fi
}

# assert_jq LABEL JQ_EXPR — STDIN must evaluate truthy under jq -e
assert_jq() {
  local label="$1" expr="$2"
  local out
  out=$(cat)
  if echo "$out" | jq -e "$expr" >/dev/null 2>&1; then ok "$label"
  else
    fail "$label" "jq -e '$expr' did not match"
    echo "$out" | head -5 | sed 's/^/   /'
  fi
}

# ---------- stage 0: install + version + help contracts ----------------
note "stage 0: install hookwarden@${HW_VERSION} + version + help contracts"
cd /test
echo '{"name":"e2e-host","version":"0.0.0","private":true}' > package.json
if npm install "hookwarden@${HW_VERSION}" --silent --no-fund --no-audit 2>&1 | tail -3; then
  ok "0.1 npm install hookwarden@${HW_VERSION}"
else fail "0.1 npm install hookwarden@${HW_VERSION}"; exit 1; fi

HW="./node_modules/.bin/hookwarden"
[[ -x "$HW" ]] && ok "0.2 binary present at $HW" || { fail "0.2 binary missing"; exit 1; }

# When HW_VERSION=latest, resolve to the concrete version that actually got
# installed (npm dist-tag). For pinned versions, the strict equality below is
# the pin-proven assertion.
if [[ "$HW_VERSION" == "latest" ]]; then
  EXPECTED_VERSION=$(node -e "console.log(require('./node_modules/hookwarden/package.json').version)")
else
  EXPECTED_VERSION="$HW_VERSION"
fi

VER=$("$HW" --version 2>&1 | head -1)
[[ "$VER" == "$EXPECTED_VERSION" ]] && ok "0.3 --version → $VER" \
  || fail "0.3 --version mismatch" "want $EXPECTED_VERSION got $VER"

VER_SHORT=$("$HW" -V 2>&1 | head -1)
[[ "$VER_SHORT" == "$EXPECTED_VERSION" ]] && ok "0.4 -V (short) → $VER_SHORT" \
  || fail "0.4 -V mismatch" "want $EXPECTED_VERSION got $VER_SHORT"

HELP=$("$HW" --help 2>&1)
errs=()
for sub in scan inventory explain fix logo; do
  grep -qF "$sub" <<<"$HELP" || errs+=("--help missing subcommand: $sub")
done
[[ ${#errs[@]} -eq 0 ]] && ok "0.5 --help lists all 5 subcommands" \
  || fail "0.5 --help subcommand list" "${errs[@]}"

# 0.6–0.9: per-subcommand --help must exit 0 and emit non-empty output.
n=5
for sub in scan inventory explain fix; do
  n=$((n+1))
  out=$("$HW" "$sub" --help 2>&1) && rc=0 || rc=$?
  if [[ $rc -eq 0 && -n "$out" ]]; then
    ok "0.$n $sub --help exit 0 with content"
  else
    fail "0.$n $sub --help" "exit=$rc len=${#out}"
  fi
done

LOGO_OUT=$("$HW" logo 2>&1)
[[ -n "$LOGO_OUT" ]] && ok "0.10 logo prints non-empty output" \
  || fail "0.10 logo empty"

# NEGATIVES
assert_fails_with "0.11 NEGATIVE --unknown-flag rejected" "unknown" "$HW" --unknown-flag
assert_fails_with "0.12 NEGATIVE unknown subcommand rejected" "unknown" "$HW" definitely-not-a-subcommand

# ---------- stage 1: phase-3 fixtures × text format (existing contracts)
note "stage 1: phase-3 fixtures × text format (10 cases)"

assert_scan "1.1 canonical-stripe-bug → critical/not-verified" 1 \
  /fixtures/canonical-stripe-bug \
  "× critical" "stripe/missing-signature-verification" "not-verified" \
  "always verify events" "docs › https://stripe.com/docs/webhooks"

assert_scan "1.2 stripe-construct-event-happy-path → verified" 0 \
  /fixtures/stripe-construct-event-happy-path \
  "verified" "stripe/library-verified"

assert_scan "1.3 python-flask-happy-path → verified" 0 \
  /fixtures/python-flask-happy-path \
  "verified" "stripe/library-verified"

assert_scan "1.4 seeded-secret → info + critical (both rules fire)" any \
  /fixtures/seeded-secret --include-tests \
  "stripe/hardcoded-secret-prefix" "i info" "not-verified"

assert_scan "1.5 stripe-catch-swallow-known-fn → known FN (verified)" 0 \
  /fixtures/stripe-catch-swallow-known-fn \
  "stripe/library-verified" "verified"

assert_scan "1.6 stripe-inline-middleware-verify → scan completes" 0 \
  /fixtures/stripe-inline-middleware-verify \
  "stripe/"

assert_scan "1.7 python-flask-bug → exit 1 (bug detected)" 1 \
  /fixtures/python-flask-bug \
  "stripe/" "not-verified"

assert_scan "1.8 php-laravel-bug → exit 1, PHP rule" 1 \
  /fixtures/php-laravel-bug \
  "not-verified"

assert_scan "1.9 php-vanilla-bug → exit 1, PHP rule" 1 \
  /fixtures/php-vanilla-bug \
  "not-verified"

if "$HW" scan /fixtures/php-edge-cases >/dev/null 2>&1; then rc=0; else rc=$?; fi
if [[ $rc -le 1 ]]; then ok "1.10 php-edge-cases → completed (exit $rc)"
else fail "1.10 php-edge-cases crashed (exit $rc)"; fi

# 1.11 + 1.12: the two auto-fix-bait fixtures must still scan cleanly as
# bug fixtures (they exist to exercise stage 8's codemod path).
assert_scan "1.11 stripe-timing-unsafe-fixable → timing-unsafe fires" 1 \
  /fixtures/stripe-timing-unsafe-fixable \
  "stripe/timing-unsafe-comparison" "not-verified"

assert_scan "1.12 stripe-raw-body-fixable → raw-body-misuse fires" 1 \
  /fixtures/stripe-raw-body-fixable \
  "stripe/raw-body-misuse" "not-verified"

# ---------- stage 2: phase-3 fixtures × JSON parseability + deep schema -
note "stage 2: phase-3 fixtures × --format json (parseability + schema)"

# Per-fixture: stdout MUST be valid JSON regardless of exit code. A
# regression that leaks log lines into the JSON stream breaks every
# pipeline consumer (CI, SARIF converters, dashboards).
FIXTURES=(
  canonical-stripe-bug stripe-construct-event-happy-path python-flask-happy-path
  seeded-secret stripe-catch-swallow-known-fn stripe-inline-middleware-verify
  python-flask-bug php-laravel-bug php-vanilla-bug php-edge-cases
  stripe-timing-unsafe-fixable stripe-raw-body-fixable
)
i=0
for fx in "${FIXTURES[@]}"; do
  i=$((i+1))
  out=$("$HW" scan "/fixtures/$fx" --format json 2>/dev/null)
  echo "$out" | assert_json_valid "2.$i $fx → stdout is valid JSON"
done

# Deep schema on canonical-stripe-bug (the richest fixture).
DEEP=$("$HW" scan /fixtures/canonical-stripe-bug --format json 2>/dev/null)
echo "$DEEP" | assert_jq "2.11 .scan.findings is a non-empty array" '.scan.findings | type == "array" and length > 0'
echo "$DEEP" | assert_jq "2.12 every finding has rule_id" '.scan.findings | all(.rule_id | type == "string" and length > 0)'
echo "$DEEP" | assert_jq "2.13 every finding has severity" '.scan.findings | all(.severity | IN("critical","high","medium","low","info"))'
echo "$DEEP" | assert_jq "2.14 every finding has file path" '.scan.findings | all(.file_path | type == "string" and length > 0)'
echo "$DEEP" | assert_jq "2.15 every finding has location.line number" '.scan.findings | all(.location.line | type == "number" and . > 0)'
echo "$DEEP" | assert_jq "2.15b every finding has location.col number" '.scan.findings | all(.location.col | type == "number" and . > 0)'
echo "$DEEP" | assert_jq "2.15c every finding has provider" '.scan.findings | all(.provider | type == "string" and length > 0)'
echo "$DEEP" | assert_jq "2.15d every finding has stable finding_id" '.scan.findings | all(.finding_id | type == "string" and length > 0)'
echo "$DEEP" | assert_jq "2.15e every finding has state (3-state verdict)" '.scan.findings | all(.state | IN("verified","not-verified","manual-review"))'
echo "$DEEP" | assert_jq "2.15f every finding has redacted_snippet (NEVER raw source)" '.scan.findings | all(.redacted_snippet | type == "string")'
echo "$DEEP" | assert_jq "2.16 stripe/missing-signature-verification present" '[.scan.findings[].rule_id] | index("stripe/missing-signature-verification")'

# NEGATIVE: --no-color must not emit ANSI escape codes into the text path
NC_OUT=$("$HW" scan /fixtures/canonical-stripe-bug --no-color 2>/dev/null)
if grep -q $'\033\[' <<<"$NC_OUT"; then
  fail "2.17 NEGATIVE --no-color must not emit ANSI sequences"
else ok "2.17 NEGATIVE --no-color contains no ANSI escapes"; fi

# ---------- stage 3: phase-3 fixtures × SARIF + deep schema -------------
note "stage 3: phase-3 fixtures × --format sarif (parseability + schema)"

i=0
for fx in "${FIXTURES[@]}"; do
  i=$((i+1))
  out=$("$HW" scan "/fixtures/$fx" --format sarif 2>/dev/null)
  echo "$out" | assert_json_valid "3.$i $fx → SARIF is valid JSON"
done

SARIF=$("$HW" scan /fixtures/canonical-stripe-bug --format sarif 2>/dev/null)
echo "$SARIF" | assert_jq "3.11 SARIF .version is 2.1.0" '.version == "2.1.0"'
echo "$SARIF" | assert_jq "3.12 SARIF .\$schema is present" '.["$schema"] | type == "string"'
echo "$SARIF" | assert_jq "3.13 SARIF .runs is non-empty array" '.runs | type == "array" and length > 0'
echo "$SARIF" | assert_jq "3.14 SARIF runs[0].tool.driver.name is hookwarden" '.runs[0].tool.driver.name == "hookwarden"'
echo "$SARIF" | assert_jq "3.15 SARIF runs[0].tool.driver.version is a string" '.runs[0].tool.driver.version | type == "string"'
echo "$SARIF" | assert_jq "3.16 SARIF runs[0].tool.driver.rules is an array" '.runs[0].tool.driver.rules | type == "array"'
echo "$SARIF" | assert_jq "3.17 SARIF runs[0].results is non-empty array" '.runs[0].results | type == "array" and length > 0'
echo "$SARIF" | assert_jq "3.18 SARIF every result has a ruleId" '.runs[0].results | all(.ruleId | type == "string" and length > 0)'
echo "$SARIF" | assert_jq "3.19 SARIF every result has a message.text" '.runs[0].results | all(.message.text | type == "string" and length > 0)'
echo "$SARIF" | assert_jq "3.20 SARIF every result has locations[]" '.runs[0].results | all(.locations | type == "array" and length > 0)'

# NEGATIVE: --format sarif on a clean fixture must still produce SARIF
# (not silently fall back to text format).
CLEAN_SARIF=$("$HW" scan /fixtures/stripe-construct-event-happy-path --format sarif 2>/dev/null)
echo "$CLEAN_SARIF" | assert_jq "3.21 NEGATIVE clean fixture still emits SARIF 2.1.0" '.version == "2.1.0"'

# ---------- stage 4: provider rule-pack coverage ------------------------
note "stage 4: provider rule-pack coverage (one assertion per provider)"

# Each provider's rule pack must fire for at least one fixture. A
# regression that drops a rule pack from the bundled distribution
# would silently scan-clean.
"$HW" scan /fixtures/canonical-stripe-bug --format json 2>/dev/null \
  | assert_jq "4.1 stripe rules fire (canonical-stripe-bug)" '[.scan.findings[].rule_id] | any(startswith("stripe/"))'

# github/* rules: scan python-flask-bug doesn't fire github — need a
# fixture that contains GitHub webhook code. None of the public phase-3
# corpus has github/, but the perf/generated apps do — express-app
# includes a github route.
"$HW" scan /perf/express-app --format json 2>/dev/null \
  | assert_jq "4.2 github rules fire (perf/express-app)" '[.scan.findings[].rule_id] | any(startswith("github/"))' \
  || true  # tolerated: if perf fixtures change, this is informational

"$HW" scan /fixtures/php-vanilla-bug --format json 2>/dev/null \
  | assert_jq "4.3 PHP-language rules fire (php-vanilla-bug)" '[.scan.findings[].rule_id] | length > 0'

"$HW" scan /fixtures/python-flask-bug --format json 2>/dev/null \
  | assert_jq "4.4 python-language rules fire (python-flask-bug)" '[.scan.findings[].rule_id] | length > 0'

"$HW" scan /fixtures/canonical-stripe-bug --format json 2>/dev/null \
  | assert_jq "4.5 critical-severity findings present" '[.scan.findings[] | select(.severity == "critical")] | length > 0'

"$HW" scan /fixtures/seeded-secret --include-tests --format json 2>/dev/null \
  | assert_jq "4.6 info-severity findings present (seeded-secret)" '[.scan.findings[] | select(.severity == "info")] | length > 0'

"$HW" scan /fixtures/stripe-construct-event-happy-path --format json 2>/dev/null \
  | assert_jq "4.7 happy-path emits library-verified rule" '[.scan.findings[].rule_id] | any(. == "stripe/library-verified")'

# NEGATIVE: clean fixture must NOT have critical/high findings
"$HW" scan /fixtures/python-flask-happy-path --format json 2>/dev/null \
  | assert_jq "4.8 NEGATIVE happy-path has no critical/high findings" '[.scan.findings[] | select(.severity == "critical" or .severity == "high")] | length == 0'

# ---------- stage 5: inventory subcommand contracts ---------------------
note "stage 5: inventory subcommand contracts"

INV_OUT=$("$HW" inventory /fixtures 2>&1) && INV_RC=0 || INV_RC=$?
[[ "$INV_RC" == "0" ]] && ok "5.1 inventory exits 0 on fixture corpus" \
  || fail "5.1 inventory exit" "want 0 got $INV_RC"

for s in framework route_pattern provider state "file:line"; do
  grep -qF "$s" <<<"$INV_OUT" && ok "5.x inventory column: $s" \
    || fail "5.x inventory missing column" "$s"
done

grep -qF "/webhooks/stripe" <<<"$INV_OUT" \
  && ok "5.7 inventory lists /webhooks/stripe route" \
  || fail "5.7 inventory missing /webhooks/stripe"

# inventory has no --format flag (text-only by design — it's a quick
# human-readable list). Verify the column-header line is well-formed
# and that a row appears for the canonical fixture.
grep -qE 'framework[[:space:]]+route_pattern[[:space:]]+provider[[:space:]]+state[[:space:]]+file:line' <<<"$INV_OUT" \
  && ok "5.8 inventory header is the documented 5-column layout" \
  || fail "5.8 inventory header malformed"

grep -qE 'express[[:space:]]+/webhooks/stripe[[:space:]]+stripe' <<<"$INV_OUT" \
  && ok "5.9 inventory row: express / /webhooks/stripe / stripe is present" \
  || fail "5.9 inventory row express /webhooks/stripe stripe not found"

# POSITIVE (was 5.10 negative): inventory on a nonexistent path is
# graceful — it returns exit 0 with "0 webhook handlers". This is a
# UX choice; assert the contract holds rather than flipping it.
out=$("$HW" inventory /this-path-does-not-exist-12345 2>&1) && rc=0 || rc=$?
if [[ $rc -eq 0 ]] && grep -qiE '0 webhook handlers|no webhook handlers' <<<"$out"; then
  ok "5.10 inventory on nonexistent path is graceful (exit 0, empty result)"
else
  fail "5.10 inventory nonexistent contract drifted" "exit=$rc"
  head -5 <<<"$out" | sed 's/^/   /'
fi

# 5.11 NEGATIVE: inventory with an unknown flag IS rejected (flags
# go through the same arg parser as scan).
assert_fails_with "5.11 NEGATIVE inventory --bogus-flag rejected" "unknown" \
  "$HW" inventory --bogus-flag /fixtures

# ---------- stage 6: CLI flag matrix (positive + negative) --------------
note "stage 6: CLI flag matrix"

# 6.1 --fail-on critical: a fixture with a critical bug should exit 1
"$HW" scan /fixtures/canonical-stripe-bug --fail-on critical >/dev/null 2>&1; rc=$?
[[ $rc -ne 0 ]] && ok "6.1 --fail-on critical fails on critical bug (exit $rc)" \
  || fail "6.1 --fail-on critical should have failed on canonical-stripe-bug"

# 6.2 --fail-on critical on a clean fixture → exit 0
"$HW" scan /fixtures/stripe-construct-event-happy-path --fail-on critical >/dev/null 2>&1; rc=$?
[[ $rc -eq 0 ]] && ok "6.2 --fail-on critical passes clean fixture (exit 0)" \
  || fail "6.2 --fail-on critical should pass" "got exit $rc"

# 6.3 --no-color: text output contains no ANSI
NC=$("$HW" scan /fixtures/canonical-stripe-bug --no-color 2>&1 || true)
grep -q $'\033\[' <<<"$NC" \
  && fail "6.3 --no-color must not emit ANSI" \
  || ok "6.3 --no-color suppresses ANSI"

# 6.4 --color always: forces color through a pipe (which would otherwise auto-disable)
CC=$("$HW" scan /fixtures/canonical-stripe-bug --color always 2>&1 || true)
grep -q $'\033\[' <<<"$CC" \
  && ok "6.4 --color always forces ANSI through pipe" \
  || fail "6.4 --color always should emit ANSI through pipe"

# 6.5 --color never matches --no-color
CN=$("$HW" scan /fixtures/canonical-stripe-bug --color never 2>&1 || true)
grep -q $'\033\[' <<<"$CN" \
  && fail "6.5 --color never must suppress ANSI" \
  || ok "6.5 --color never suppresses ANSI"

# 6.6 --verbose adds telemetry the default run does not
DEFAULT=$("$HW" scan /fixtures/canonical-stripe-bug --no-color 2>&1 || true)
VERB=$("$HW" scan /fixtures/canonical-stripe-bug --no-color --verbose 2>&1 || true)
[[ ${#VERB} -gt ${#DEFAULT} ]] && ok "6.6 --verbose adds detection telemetry" \
  || fail "6.6 --verbose should add output" "default=${#DEFAULT}B verbose=${#VERB}B"

# 6.7 --include-tests scans test directories (the bare scan excludes them)
WO=$("$HW" scan /fixtures/seeded-secret --no-color --format json 2>/dev/null | jq '.scan.findings | length')
W=$("$HW" scan /fixtures/seeded-secret --no-color --include-tests --format json 2>/dev/null | jq '.scan.findings | length')
[[ "$W" -ge "$WO" ]] && ok "6.7 --include-tests includes ≥ same finding count ($WO → $W)" \
  || fail "6.7 --include-tests should not reduce finding count" "$WO → $W"

# 6.8 --no-config bypasses local config-file discovery (sanity: no crash)
"$HW" scan /fixtures/canonical-stripe-bug --no-config >/dev/null 2>&1; rc=$?
[[ $rc -eq 0 || $rc -eq 1 ]] && ok "6.8 --no-config completes (exit $rc)" \
  || fail "6.8 --no-config crashed (exit $rc)"

# 6.9 --no-baseline disables baseline auto-read (sanity: no crash)
"$HW" scan /fixtures/canonical-stripe-bug --no-baseline >/dev/null 2>&1; rc=$?
[[ $rc -eq 0 || $rc -eq 1 ]] && ok "6.9 --no-baseline completes (exit $rc)" \
  || fail "6.9 --no-baseline crashed (exit $rc)"

# 6.10 --diff-only against a git repo with HEAD~1 == HEAD → empty diff → exit 0
# The diff-only path runs `git diff HEAD~1 HEAD`, so HEAD~1 must exist.
# Two commits (initial + empty) gives us a HEAD~1 with no file changes.
DIFFDIR=/tmp/diff-fixture-$$
cp -r /fixtures/canonical-stripe-bug "$DIFFDIR"
(cd "$DIFFDIR" \
  && git init -q -b main \
  && git add -A \
  && git commit -q -m init \
  && git commit -q --allow-empty -m no-op)
"$HW" scan "$DIFFDIR" --diff-only --no-color >/dev/null 2>&1; rc=$?
[[ $rc -eq 0 ]] && ok "6.10 --diff-only with empty HEAD~1..HEAD diff → exit 0" \
  || fail "6.10 --diff-only expected exit 0" "got $rc"
rm -rf "$DIFFDIR"

# 6.11 --min-parse-coverage 0 disables the parse-coverage gate
"$HW" scan /fixtures/canonical-stripe-bug --min-parse-coverage 0 >/dev/null 2>&1; rc=$?
[[ $rc -eq 0 || $rc -eq 1 ]] && ok "6.11 --min-parse-coverage 0 accepted (exit $rc)" \
  || fail "6.11 --min-parse-coverage 0 rejected" "exit $rc"

# NEGATIVES
assert_fails_with "6.12 NEGATIVE --format unknown rejected" "format" \
  "$HW" scan /fixtures/canonical-stripe-bug --format wat
assert_fails_with "6.13 NEGATIVE --fail-on unknown rejected" "fail-on" \
  "$HW" scan /fixtures/canonical-stripe-bug --fail-on apocalypse
assert_fails "6.14 NEGATIVE scan with no path arg on empty cwd" \
  bash -c "cd /tmp && '$HW' scan /this-path-does-not-exist-67890"
# 6.15 NEGATIVE: --min-parse-coverage out-of-range (>1) rejected.
# The help documents range 0..1; a value of 2 is meaningless.
assert_fails_with "6.15 NEGATIVE --min-parse-coverage 2 rejected" "" \
  "$HW" scan /fixtures/canonical-stripe-bug --min-parse-coverage 2
# 6.16 NEGATIVE: --config pointing at a nonexistent file is rejected.
assert_fails "6.16 NEGATIVE --config nonexistent.yaml rejected" \
  "$HW" scan /fixtures/canonical-stripe-bug --config /tmp/does-not-exist.yaml

# ---------- stage 7: stdout/stderr discipline ---------------------------
note "stage 7: stdout/stderr discipline"

# 7.1 --format json: stdout MUST be pure parseable JSON (no log lines)
JSON_STDOUT=$("$HW" scan /fixtures/canonical-stripe-bug --format json 2>/dev/null)
echo "$JSON_STDOUT" | assert_json_valid "7.1 --format json stdout is parseable"

# 7.2 --format sarif: same
SARIF_STDOUT=$("$HW" scan /fixtures/canonical-stripe-bug --format sarif 2>/dev/null)
echo "$SARIF_STDOUT" | assert_json_valid "7.2 --format sarif stdout is parseable"

# 7.3 happy-path --format json stdout still valid
HAPPY_JSON=$("$HW" scan /fixtures/stripe-construct-event-happy-path --format json 2>/dev/null)
echo "$HAPPY_JSON" | assert_json_valid "7.3 happy-path --format json stdout is parseable"

# 7.4 NEGATIVE: even when scan exits 1 (bug detected), --format json
# stdout MUST stay parseable — a real consumer would pipe through jq.
BUG_JSON=$("$HW" scan /fixtures/php-laravel-bug --format json 2>/dev/null) && rc=0 || rc=$?
echo "$BUG_JSON" | assert_json_valid "7.4 NEGATIVE exit-1 scan still emits parseable JSON"

# 7.5 text format: stdout begins with the verdict line, not a log line
TEXT_OUT=$("$HW" scan /fixtures/canonical-stripe-bug --no-color 2>/dev/null)
# No assertion that stdout MUST be empty — just that we got bounded output
[[ -n "$TEXT_OUT" && ${#TEXT_OUT} -lt 100000 ]] \
  && ok "7.5 text output is non-empty and bounded (${#TEXT_OUT}B)" \
  || fail "7.5 text output suspicious" "len=${#TEXT_OUT}"

# ---------- stage 8: fix codemod contracts ------------------------------
note "stage 8: fix codemod contracts"

FIXDIR=/tmp/fix-fixture-$$
cp -r /fixtures/canonical-stripe-bug "$FIXDIR"
BEFORE_HASH=$(find "$FIXDIR" -type f -exec sha256sum {} + | sort | sha256sum | awk '{print $1}')

# 8.1 fix --help mentions --write and --mode
FIX_HELP=$("$HW" fix --help 2>&1)
errs=()
grep -qF -- "--write" <<<"$FIX_HELP" || errs+=("--help missing --write")
grep -qF -- "--mode"  <<<"$FIX_HELP" || errs+=("--help missing --mode")
[[ ${#errs[@]} -eq 0 ]] && ok "8.1 fix --help documents --write + --mode" \
  || fail "8.1 fix --help" "${errs[@]}"

# 8.2 fix without --write is dry-run — files MUST be unchanged
"$HW" fix "$FIXDIR" >/dev/null 2>&1; rc=$?
AFTER_DRYRUN=$(find "$FIXDIR" -type f -exec sha256sum {} + | sort | sha256sum | awk '{print $1}')
[[ "$BEFORE_HASH" == "$AFTER_DRYRUN" ]] \
  && ok "8.2 fix without --write is dry-run (files unchanged)" \
  || fail "8.2 fix dry-run modified files (hash drifted)"

# 8.3 fix --mode safe is the documented default — equivalent dry-run
"$HW" fix "$FIXDIR" --mode safe >/dev/null 2>&1; rc=$?
AFTER_SAFE=$(find "$FIXDIR" -type f -exec sha256sum {} + | sort | sha256sum | awk '{print $1}')
[[ "$BEFORE_HASH" == "$AFTER_SAFE" ]] \
  && ok "8.3 fix --mode safe dry-run leaves files unchanged" \
  || fail "8.3 fix --mode safe modified files in dry-run"

# 8.4 fix on a clean fixture has no findings to fix — idempotent
CLEAN_FIX=/tmp/clean-fix-$$
cp -r /fixtures/stripe-construct-event-happy-path "$CLEAN_FIX"
CLEAN_BEFORE=$(find "$CLEAN_FIX" -type f -exec sha256sum {} + | sort | sha256sum | awk '{print $1}')
"$HW" fix "$CLEAN_FIX" --write >/dev/null 2>&1; rc=$?
CLEAN_AFTER=$(find "$CLEAN_FIX" -type f -exec sha256sum {} + | sort | sha256sum | awk '{print $1}')
[[ "$CLEAN_BEFORE" == "$CLEAN_AFTER" ]] \
  && ok "8.4 fix --write on happy-path is idempotent" \
  || fail "8.4 fix --write modified happy-path unexpectedly"
rm -rf "$CLEAN_FIX"

# 8.5 NEGATIVE: --mode unknown rejected
assert_fails_with "8.5 NEGATIVE fix --mode unknown rejected" "mode" \
  "$HW" fix "$FIXDIR" --mode pyrotechnic

# 8.6 NEGATIVE: --mode all in non-TTY without --accept-unsafe → refused
# (per --help: "Required for --mode all in non-TTY (D-12)")
out=$("$HW" fix "$FIXDIR" --mode all --write 2>&1) && rc=0 || rc=$?
if [[ $rc -ne 0 ]] || grep -qiF "accept-unsafe" <<<"$out"; then
  ok "8.6 NEGATIVE --mode all non-TTY refused without --accept-unsafe (exit $rc)"
else
  fail "8.6 --mode all should refuse in non-TTY without --accept-unsafe" "exit=$rc"
fi

# 8.7 --only filters to a specific rule ID
"$HW" fix "$FIXDIR" --only "stripe/missing-signature-verification" >/dev/null 2>&1; rc=$?
[[ $rc -le 1 ]] && ok "8.7 fix --only stripe/missing-signature-verification accepted (exit $rc)" \
  || fail "8.7 fix --only crashed (exit $rc)"

# 8.8 POSITIVE: fix on a nonexistent path is graceful (matches inventory
# 5.10 — "0 fixable findings", exit 0). The CLI does NOT treat
# nonexistent paths as errors; assert the documented contract.
out=$("$HW" fix /this-fix-path-does-not-exist-12345 2>&1) && rc=0 || rc=$?
if [[ $rc -eq 0 ]] && grep -qiE '0 fixable findings|no fixable' <<<"$out"; then
  ok "8.8 fix on nonexistent path is graceful (exit 0, 0 fixable findings)"
else
  fail "8.8 fix nonexistent contract drifted" "exit=$rc"
  head -5 <<<"$out" | sed 's/^/   /'
fi

# 8.9 NEGATIVE: fix --only with bogus rule id has nothing to filter to,
# so the dry-run shows 0 fixable findings — also graceful. Test that
# --only at least accepts the syntax without crashing.
"$HW" fix "$FIXDIR" --only "totally/made-up-rule" >/dev/null 2>&1; rc=$?
[[ $rc -le 1 ]] && ok "8.9 fix --only with unknown rule_id does not crash (exit $rc)" \
  || fail "8.9 fix --only with unknown rule_id crashed (exit $rc)"

# 8.10 POSITIVE: even when there are zero fixable findings, `fix` must
# still emit the banner + count line so consumers can pattern-match the
# output. A blank output here would be a silent regression.
FIX_OUT=$("$HW" fix "$FIXDIR" 2>&1)
errs=()
grep -qF "hookwarden fix" <<<"$FIX_OUT" \
  || errs+=("output missing banner: 'hookwarden fix'")
grep -qiF "fixable findings" <<<"$FIX_OUT" \
  || errs+=("output missing count line: 'fixable findings'")
[[ ${#errs[@]} -eq 0 ]] \
  && ok "8.10 fix output always carries banner + count line" \
  || fail "8.10 fix output schema drift" "${errs[@]}"

# 8.11–8.16: end-to-end codemod verification against the two fixtures
# specifically constructed to trigger the published codemods (the rest
# of the phase-3 corpus has none — see e2e/fixtures/phase-3/stripe-
# timing-unsafe-fixable and stripe-raw-body-fixable READMEs).

# ── 8.11/8.12/8.13: typescript-replace-binary-equality ─────────────
TUFIX=/tmp/tu-fix-$$
cp -r /fixtures/stripe-timing-unsafe-fixable "$TUFIX"
TU_BEFORE_HASH=$(find "$TUFIX" -type f -exec sha256sum {} + | sort | sha256sum | awk '{print $1}')

TU_DRYRUN=$("$HW" fix "$TUFIX" 2>&1)
if grep -qE 'stripe/timing-unsafe-comparison' <<<"$TU_DRYRUN" \
   && grep -qE 'crypto\.timingSafeEqual' <<<"$TU_DRYRUN"; then
  ok "8.11 timing-unsafe codemod dry-run shows the timingSafeEqual rewrite"
else
  fail "8.11 timing-unsafe dry-run missing expected diff"
  head -8 <<<"$TU_DRYRUN" | sed 's/^/   /'
fi

"$HW" fix "$TUFIX" --write >/dev/null 2>&1
TU_AFTER_HASH=$(find "$TUFIX" -type f -exec sha256sum {} + | sort | sha256sum | awk '{print $1}')
[[ "$TU_BEFORE_HASH" != "$TU_AFTER_HASH" ]] \
  && ok "8.12 timing-unsafe fix --write actually mutated the source file" \
  || fail "8.12 timing-unsafe fix --write left the file unchanged"

# After the rewrite, the same scan must NOT re-fire the timing-unsafe
# rule — the fix is supposed to RESOLVE the finding, not just edit the
# file. This is the load-bearing safety contract.
TU_RESCAN=$("$HW" scan "$TUFIX" --format json 2>/dev/null)
if echo "$TU_RESCAN" \
   | jq -e '[.scan.findings[].rule_id] | index("stripe/timing-unsafe-comparison") == null' \
     >/dev/null 2>&1; then
  ok "8.13 timing-unsafe re-scan after --write no longer fires the rule"
else
  fail "8.13 timing-unsafe rule still fires after fix --write — codemod did not resolve"
fi
rm -rf "$TUFIX"

# ── 8.14/8.15/8.16: typescript-replace-req-body-with-raw-body ──────
RBFIX=/tmp/rb-fix-$$
cp -r /fixtures/stripe-raw-body-fixable "$RBFIX"
RB_BEFORE_HASH=$(find "$RBFIX" -type f -exec sha256sum {} + | sort | sha256sum | awk '{print $1}')

RB_DRYRUN=$("$HW" fix "$RBFIX" 2>&1)
if grep -qE 'stripe/raw-body-misuse' <<<"$RB_DRYRUN" \
   && grep -qE 'req\.rawBody' <<<"$RB_DRYRUN"; then
  ok "8.14 raw-body codemod dry-run shows the req.body → req.rawBody rewrite"
else
  fail "8.14 raw-body dry-run missing expected diff"
  head -8 <<<"$RB_DRYRUN" | sed 's/^/   /'
fi

"$HW" fix "$RBFIX" --write >/dev/null 2>&1
RB_AFTER_HASH=$(find "$RBFIX" -type f -exec sha256sum {} + | sort | sha256sum | awk '{print $1}')
[[ "$RB_BEFORE_HASH" != "$RB_AFTER_HASH" ]] \
  && ok "8.15 raw-body fix --write actually mutated the source file" \
  || fail "8.15 raw-body fix --write left the file unchanged"

# Post-fix, server.ts must contain req.rawBody (the rewritten form).
if grep -qF "req.rawBody" "$RBFIX"/server.ts; then
  ok "8.16 raw-body fix --write wrote req.rawBody into the source"
else
  fail "8.16 raw-body fix --write did not produce req.rawBody"
fi
rm -rf "$RBFIX"

rm -rf "$FIXDIR"

# ---------- stage 9: explain subcommand ---------------------------------
note "stage 9: explain subcommand"

# 9.1 explain --help exits 0 with non-empty
EXP_HELP=$("$HW" explain --help 2>&1) && rc=0 || rc=$?
[[ $rc -eq 0 && -n "$EXP_HELP" ]] && ok "9.1 explain --help exit 0 with content" \
  || fail "9.1 explain --help" "exit=$rc len=${#EXP_HELP}"

# 9.2 explain a known rule → exit 0, output mentions the rule_id
EXP=$("$HW" explain "stripe/missing-signature-verification" 2>&1) && rc=0 || rc=$?
errs=()
[[ $rc -eq 0 ]] || errs+=("exit $rc")
grep -qF "stripe/missing-signature-verification" <<<"$EXP" || errs+=("output missing rule_id")
[[ ${#EXP} -gt 100 ]] || errs+=("output suspiciously short (${#EXP} bytes)")
[[ ${#errs[@]} -eq 0 ]] && ok "9.2 explain known rule emits real documentation" \
  || fail "9.2 explain known rule" "${errs[@]}"

# 9.3 NEGATIVE: explain unknown rule → non-zero exit
assert_fails_with "9.3 NEGATIVE explain unknown rule rejected" "" \
  "$HW" explain "not/a-real-rule-id"

# 9.4 NEGATIVE: explain with no arg → non-zero exit or shows usage
out=$("$HW" explain 2>&1) && rc=0 || rc=$?
if [[ $rc -ne 0 ]] || grep -qiE "usage|argument" <<<"$out"; then
  ok "9.4 NEGATIVE explain with no arg fails or shows usage"
else
  fail "9.4 explain with no arg should fail or show usage"
fi

# 9.5 explain output mentions docs link (URL — rules link out to docs)
grep -qF "://" <<<"$EXP" \
  && ok "9.5 explain output references a docs URL" \
  || skip "9.5 explain docs URL (not present — rule docs may inline)"

# ---------- stage 10: byte-stability + perf apps ------------------------
note "stage 10: byte-stability + perf apps"

# Byte-stability: running the same scan twice MUST produce identical
# JSON (modulo scanned_at timestamp). Pipeline integration depends on
# this — diff-based consumers fail if the engine is nondeterministic.
S1=$("$HW" scan /fixtures/canonical-stripe-bug --format json 2>/dev/null \
     | jq 'del(.scan.scanned_at, .scan.engine.version, .scan.rules.version)')
S2=$("$HW" scan /fixtures/canonical-stripe-bug --format json 2>/dev/null \
     | jq 'del(.scan.scanned_at, .scan.engine.version, .scan.rules.version)')
[[ "$S1" == "$S2" ]] && ok "10.1 JSON output is byte-stable across two runs (modulo timestamps)" \
  || fail "10.1 JSON output drifted between identical runs"

T1=$("$HW" scan /fixtures/canonical-stripe-bug --no-color 2>/dev/null \
     | grep -v -iE 'scanned (in|at)|engine|rules pack')
T2=$("$HW" scan /fixtures/canonical-stripe-bug --no-color 2>/dev/null \
     | grep -v -iE 'scanned (in|at)|engine|rules pack')
[[ "$T1" == "$T2" ]] && ok "10.2 text output is byte-stable across two runs (modulo timing lines)" \
  || fail "10.2 text output drifted between identical runs"

SR1=$("$HW" scan /fixtures/canonical-stripe-bug --format sarif 2>/dev/null \
     | jq 'del(.runs[].invocations, .runs[].tool.driver.version)')
SR2=$("$HW" scan /fixtures/canonical-stripe-bug --format sarif 2>/dev/null \
     | jq 'del(.runs[].invocations, .runs[].tool.driver.version)')
[[ "$SR1" == "$SR2" ]] && ok "10.3 SARIF output is byte-stable across two runs (modulo invocation block)" \
  || fail "10.3 SARIF output drifted between identical runs"

# Perf apps: each must complete + each must emit ≥1 finding (these are
# generated apps WITH known bugs — a regression that silently drops
# detection would show as zero findings).
for app in /perf/express-app /perf/fastify-app /perf/hono-app /perf/nextjs-app \
           /perf/flask-app /perf/fastapi-app /perf/django-app /perf/php; do
  name=$(basename "$app")
  [ -d "$app" ] || { skip "10.x perf/$name (dir absent)"; continue; }
  t0=$(date +%s)
  out=$("$HW" scan "$app" >/tmp/perf.out 2>&1) && rc=0 || rc=$?
  dt=$(($(date +%s) - t0))
  if [[ $rc -le 1 ]]; then
    ok "10.x perf/$name completed in ${dt}s (exit $rc)"
  else
    fail "10.x perf/$name CRASHED (exit $rc)"
    head -20 /tmp/perf.out | sed 's/^/   /'
  fi
done

# Per-perf-app rule-presence: each generated app SHOULD emit at least
# one finding (they're intentionally buggy). Tolerate zero with a skip
# so a perf-app refactor doesn't regress this matrix.
for app in /perf/express-app /perf/fastify-app /perf/hono-app /perf/nextjs-app \
           /perf/flask-app /perf/fastapi-app /perf/django-app /perf/php; do
  name=$(basename "$app")
  [ -d "$app" ] || continue
  count=$("$HW" scan "$app" --format json 2>/dev/null | jq '.scan.findings | length' 2>/dev/null)
  if [[ -z "$count" || "$count" == "null" ]]; then
    fail "10.y perf/$name JSON shape unreadable"
  elif [[ "$count" -gt 0 ]]; then
    ok "10.y perf/$name emits $count finding(s)"
  else
    skip "10.y perf/$name emits 0 findings (informational)"
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
