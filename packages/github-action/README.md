# hookwarden — GitHub Action

Webhook signature-verification audit for GitHub Actions. New findings on every PR, SARIF to Code Scanning, failed check on threshold breach.

The Action is a thin wrapper around the [hookwarden CLI](https://github.com/Hookwarden/hookwarden) — same binary, same rules, same engine. Behavior parity with `npx hookwarden scan` by construction (ACTION-01 same-binary invariant).

## Quickstart

```yaml
# .github/workflows/hookwarden.yml
name: hookwarden
on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  pull-requests: write     # PR summary comment
  security-events: write   # SARIF upload to Code Scanning

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0    # required for base-branch comparison on PRs
      - uses: Hookwarden/hookwarden-action@v1
        with:
          fail-on: high     # default; override if needed
```

## Permissions

The Action requires exactly three permissions. Declare them explicitly — modern workflows ship with restricted defaults, so omitted permissions silently disable features.

| Permission              | Reason                                                                 |
| ----------------------- | ---------------------------------------------------------------------- |
| `contents: read`        | `actions/checkout` + base-branch fetch on PR events                    |
| `pull-requests: write`  | Sticky PR summary comment (skipped with a warning if missing)          |
| `security-events: write`| SARIF upload to GitHub Code Scanning (skipped with a warning if missing) |

The Action does **NOT** require any `checks` write permission. Failed-check semantics flow from the workflow step's exit code — when `hookwarden scan` exits 1 (findings ≥ `fail-on`), GitHub marks the check failed automatically.

> **Avoid `permissions: write-all`** — copy-pasting from older actions can over-grant permissions across the entire job. Use the minimum three-line set above; principle of least privilege.

## Inputs

| Input               | Default            | Description                                                                                                              |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `fail-on`           | `high`             | Severity threshold (`critical` / `high` / `medium` / `low`). Findings at or above this severity fail the check.          |
| `config-path`       | _(walk-up search)_ | Path to `hookwarden.config.yaml`. If omitted, the Action walks up from `working-directory` per the CLI's config precedence. |
| `working-directory` | `.`                | Scan + config-walk root. Set this for monorepo packages.                                                                  |

## Outputs

All four outputs are set on every run.

| Output                  | Type   | When                                                                                  |
| ----------------------- | ------ | ------------------------------------------------------------------------------------- |
| `findings-count`        | number | Always. Total active findings in head scan.                                           |
| `new-findings-count`    | number | PR events only (push/schedule = 0). Findings in head not present in base.             |
| `findings-by-severity`  | JSON   | Always. `{ critical, high, medium, low, info }`                                        |
| `sarif-path`            | string | Always. Absolute path under `${{ runner.temp }}/hookwarden.sarif`                      |

Chain outputs into subsequent steps:

```yaml
      - id: scan
        uses: Hookwarden/hookwarden-action@v1
      - if: fromJSON(steps.scan.outputs.findings-by-severity).critical > 0
        run: echo "::warning::Critical webhook findings detected"
```

## PR feedback

Two channels work together:

1. **Code Scanning** provides the inline annotations on PR-touched lines — severity badge, rule popup, and fix suggestion. Filter by "New alerts" in the Code Scanning tab.
2. **The Action's sticky PR comment** posts ONE summary per PR with severity-grouped totals + a top-5 findings table + a link to Code Scanning.

The sticky comment is updated in place on re-runs. On a clean run with no new findings, no comment is posted; if a prior comment from an earlier run exists, it is updated to `✅ hookwarden: no new findings`.

## Versioning

| Pin      | Behavior                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------- |
| `@v1`    | Moving major-version tag; gets patches and minor releases automatically. Recommended for most users.       |
| `@vX.Y.Z`| Immutable per-release tag. Recommended for SOC2-audited workflows requiring reproducibility.              |

Both forms point at the same `dist/index.js` bundle — pinning is a guarantee about future updates, not the current code.

## Caveats

- **Fork PRs** — SARIF upload and PR summary comment are skipped (fork tokens don't carry `security-events: write` or `pull-requests: write`). The scan still runs and the check status reflects findings. The Action emits one warning per skipped channel.
- **Shallow clones** — PR scans require the base ref to be fetchable. Use `actions/checkout@v6` with `fetch-depth: 0`. The Action emits a runtime warning and falls back gracefully if the base ref isn't available, but new-finding detection is degraded.
- **Same-binary invariant** (ACTION-01) — the Action invokes the bundled `hookwarden` CLI via subprocess; the exact same code path as `npx hookwarden`. No engine forks, no rule drift.

## License + repository

Apache-2.0.

- Source: <https://github.com/Hookwarden/hookwarden>
- Bundled distribution: <https://github.com/Hookwarden/hookwarden-action>
