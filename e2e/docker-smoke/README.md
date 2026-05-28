# docker-smoke

End-to-end smoke that proves the **published** `hookwarden@<version>`
npm artefact works against the fixture corpus in a clean Node 22
container — no source tree, no dev deps, just `npm install` + scan.

Distinct from `e2e/phase-3.test.ts`, which runs `main(argv)` in-process
via vitest. That test catches engine regressions; this one catches
release-pipeline regressions (broken `bin` entry, missing peer dep,
WASM-load failure under the slim image, etc.).

## Run

```bash
./run.sh                       # pinned version (default 0.5.5)
HW_VERSION=latest ./run.sh     # head of npm
HW_VERSION=0.5.4  ./run.sh     # any previously-published version
```

Container output: per-stage `✓`/`✗` lines + a final pass/fail summary.
Exit 0 iff every stage passes.

## Coverage

- **Stage 0**: `npm install hookwarden@$HW_VERSION` succeeds; `bin`
  entry resolves; `--version` prints.
- **Stage 1**: 10 phase-3 fixtures across JS / TS / Python / PHP —
  exit codes + rule-id + state + severity + docs-link substrings
  match the documented expected output.
- **Stage 2**: `hookwarden inventory` column headers + route pattern.
- **Stage 3**: `--format json` (schema v1, `.scan.findings[]`) and
  `--format sarif` (SARIF 2.1.0, `runs[]`) shapes are valid.
- **Stage 4**: All 8 perf/generated framework apps (express, fastify,
  hono, nextjs, flask, fastapi, django, php-vanilla) scan without
  crashing.

## Not covered

- `hookwarden fix` auto-remediation engine (separate test surface).
- Standalone binaries from `bun build --compile` (macOS / Windows).
- The GitHub Action wrapper.
- pip / brew / scoop / winget install paths.
