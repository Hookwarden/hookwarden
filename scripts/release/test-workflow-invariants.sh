#!/usr/bin/env bash
# scripts/release/test-workflow-invariants.sh
# Structural invariants on the release workflows. Catches the
# YAML-level regressions that bugs 4 + 6 (issue #12) introduced.
#
# Bug 4: Windows pwsh smoke step inherited the scan's legitimate exit 1
#        despite all sub-checks passing. Fix was an explicit `exit 0`
#        at the end of the pwsh `run:` block (release-binaries.yml).
# Bug 6: aggregate "Flip PHASE_4X_BINARIES_SHIPPED" step used
#        GITHUB_TOKEN which lacked actions:write for repo variables
#        (HTTP 403). Fix was marking the step continue-on-error AND/OR
#        adding actions:write to the job's permissions.
#
# Also covers PR #16's changesets/action PR-event gate (latent bug
# that surfaces on every changeset-ADDING PR).

set -euo pipefail

cd "$(dirname "$0")/../.."

# ---- Test 1 (bug 4): pwsh smoke step ends with explicit `exit 0` ----
echo "Test 1 (bug 4): release-binaries.yml Windows pwsh smoke step must end with explicit 'exit 0'"
python3 - <<'PY'
import re
import sys

src = open(".github/workflows/release-binaries.yml").read()
lines = src.splitlines()

# Find pwsh blocks that invoke scan AND capture $LASTEXITCODE — those
# are the bug-4-shaped blocks. Other pwsh blocks (e.g. Authenticode
# signing) have no $LASTEXITCODE-from-failing-scan pattern and don't
# need an explicit exit 0.
pwsh_scan_blocks = []
i = 0
while i < len(lines):
    if re.match(r'\s*shell:\s*pwsh\s*(#|$)', lines[i]):
        j = i
        while j < len(lines) and not re.match(r'\s*run:\s*\|', lines[j]):
            j += 1
        if j == len(lines):
            i += 1
            continue
        run_indent = len(lines[j]) - len(lines[j].lstrip())
        body_start = j + 1
        body_end = body_start
        while body_end < len(lines):
            line = lines[body_end]
            if line.strip() == "":
                body_end += 1
                continue
            line_indent = len(line) - len(line.lstrip())
            if line_indent <= run_indent:
                break
            body_end += 1
        body = lines[body_start:body_end]
        body_blob = "\n".join(body)
        # Bug 4 signature: invokes scan + captures $LASTEXITCODE
        if "scan" in body_blob and "$LASTEXITCODE" in body_blob:
            pwsh_scan_blocks.append((i, body_start, body_end))
        i = body_end
    else:
        i += 1

if not pwsh_scan_blocks:
    sys.stderr.write(
        "FAIL: no pwsh blocks matching the bug-4 shape (scan + $LASTEXITCODE capture). "
        "Either the smoke step was removed or restructured — verify intent.\n"
    )
    sys.exit(1)

for (step_line, body_start, body_end) in pwsh_scan_blocks:
    body = lines[body_start:body_end]
    last_meaningful = None
    for line in reversed(body):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        last_meaningful = stripped
        break
    if last_meaningful != "exit 0":
        sys.stderr.write(
            f"FAIL: pwsh scan/smoke step starting at line {step_line + 1} does not end with "
            f"`exit 0` (found: {last_meaningful!r}). Bug 4 regression — $LASTEXITCODE from the "
            f"scan invocation will leak through and fail the step.\n"
        )
        sys.exit(1)

print(f"  PASS ({len(pwsh_scan_blocks)} pwsh scan-smoke block(s) all end with explicit `exit 0`)")
PY

# ---- Test 2 (bug 6): release-binaries.yml var-flip protection ----
echo "Test 2 (bug 6): release-binaries.yml var-flip step must be protected (actions:write perm OR continue-on-error)"
python3 - <<'PY'
import re
import sys

src = open(".github/workflows/release-binaries.yml").read()
lines = src.splitlines()

# Top-level permissions block
in_perms = False
perms_text = []
for line in lines:
    if re.match(r'^permissions:\s*$', line):
        in_perms = True
        continue
    if in_perms:
        if line and not line.startswith(' ') and not line.startswith('\t'):
            break
        perms_text.append(line)

perms_blob = "\n".join(perms_text)
has_actions_write = bool(re.search(r'\bactions:\s*write\b', perms_blob))

# Var-flip step: search for any step touching PHASE_4X_BINARIES_SHIPPED
# variable. If found, check it has continue-on-error: true within its
# 20-line window.
var_flip_continue = False
for i, line in enumerate(lines):
    if 'PHASE_4X_BINARIES_SHIPPED' in line:
        window_start = max(0, i - 10)
        window_end = min(len(lines), i + 10)
        for j in range(window_start, window_end):
            if re.search(r'continue-on-error:\s*true', lines[j]):
                var_flip_continue = True
                break
        if var_flip_continue:
            break

if not has_actions_write and not var_flip_continue:
    sys.stderr.write(
        "FAIL: bug 6 regression — neither actions:write permission nor "
        "continue-on-error on a PHASE_4X_BINARIES_SHIPPED step. The var "
        "mutation will 403 and fail the release.\n"
    )
    sys.stderr.write(f"top-level permissions block:\n{perms_blob}\n")
    sys.exit(1)

guard = []
if has_actions_write:
    guard.append("actions:write permission")
if var_flip_continue:
    guard.append("continue-on-error on var-flip")
print(f"  PASS (protected by: {', '.join(guard)})")
PY

# ---- Test 3 (PR #16 latent bug): changesets/action gated to skip PR events ----
echo "Test 3 (PR #16): release.yml changesets/action step must be gated to skip PR events"
python3 - <<'PY'
import re
import sys

src = open(".github/workflows/release.yml").read()
lines = src.splitlines()

gate_line = None
for i, line in enumerate(lines):
    if 'uses: changesets/action@' in line:
        for j in range(i - 1, max(0, i - 20), -1):
            stripped = lines[j].strip()
            if stripped.startswith('- ') and not stripped.startswith('- name:') and not stripped.startswith('- id:') and not stripped.startswith('- uses:') and not stripped.startswith('- run:'):
                break
            if stripped.startswith('if:'):
                gate_line = stripped
                break
        break

if gate_line is None:
    sys.stderr.write("FAIL: changesets/action step has no `if:` gate. PR-event 422 regression risk.\n")
    sys.exit(1)

if "pull_request" not in gate_line:
    sys.stderr.write(
        f"FAIL: changesets/action `if:` gate ({gate_line!r}) does not reference pull_request. "
        f"On PR events the action's base-ref handling 422s — see PR #16.\n"
    )
    sys.exit(1)

print(f"  PASS (gate: {gate_line!r})")
PY

# ---- Test 4 (bug 9): bump-* scripts use `git commit -q` + `git push -q` ----
echo "Test 4 (bug 9): bump-* scripts must use 'git commit -q' + 'git push -q' (preserves pristine stdout for \$GITHUB_OUTPUT capture)"
python3 - <<'PY'
import re
import sys
from pathlib import Path

# release.yml captures bump-script stdout via `sha=$(scripts/release/bump-X.sh)`
# and writes it to $GITHUB_OUTPUT. Any extra lines from `git commit` (the
# `[branch hash] msg \n N file changed, ...` block) fail $GITHUB_OUTPUT parsing
# with `Invalid format ...`. The -q flag silences git's stdout chatter so only
# the trailing `git rev-parse HEAD` reaches the caller.
SCRIPTS = [
    "scripts/release/bump-homebrew.sh",
    "scripts/release/bump-scoop.sh",
    "scripts/release/bump-hookwarden-action.sh",
]
failed = []
for path in SCRIPTS:
    src = Path(path).read_text()
    # Every `git commit` and `git push` invocation must include -q
    commit_calls = re.findall(r'^\s*git commit(\s+\S+)*', src, re.M)
    push_calls = re.findall(r'^\s*git push(\s+\S+)*', src, re.M)
    bad = []
    for line in re.findall(r'^\s*git commit(?:\s.*)?$', src, re.M):
        if not re.search(r'\s-q(\s|$)', line):
            bad.append(line.strip())
    for line in re.findall(r'^\s*git push(?:\s.*)?$', src, re.M):
        if not re.search(r'\s-q(\s|$)', line):
            bad.append(line.strip())
    if bad:
        failed.append((path, bad))

if failed:
    sys.stderr.write("FAIL: bug 9 regression — bump-* script(s) leak git output to stdout:\n")
    for path, bad in failed:
        sys.stderr.write(f"  {path}:\n")
        for line in bad:
            sys.stderr.write(f"    {line}\n")
    sys.stderr.write(
        "release.yml captures these scripts' stdout via `sha=$(...)` and feeds it "
        "to $GITHUB_OUTPUT — any extra lines from `git commit`/`git push` fail "
        "with `Invalid format`. Use `git commit -q` + `git push -q`.\n"
    )
    sys.exit(1)

print(f"  PASS ({len(SCRIPTS)} bump-* scripts all use -q on commit + push)")
PY

echo
echo "All 4 workflow-invariant tests passed."
