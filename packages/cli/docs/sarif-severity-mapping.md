# SARIF Severity Mapping

> **TODO (Phase 5):** relocate this page to `apps/docs/src/content/docs/cli/sarif-severity-mapping.md` once the Astro Starlight docs site is bootstrapped. Until then this lives next to the CLI package so the parity test can resolve it.

hookwarden emits findings with five severities. SARIF 2.1.0 has three levels.
The mapping below is what the `--format sarif` renderer emits and what
GitHub Code Scanning will display.

| hookwarden severity | SARIF level | GitHub Code Scanning behavior |
| --- | --- | --- |
| critical | error | Fails the PR check by default |
| high | error | Fails the PR check by default |
| medium | warning | Surfaces in alerts; does not fail the check |
| low | note | Surfaces in alerts; does not fail the check |
| info | note | Surfaces in alerts; does not fail the check |

## Why high → error

hookwarden publishes a <5% false-positive rate at high/critical severity (target).
A "high" finding has roughly a 95% probability of being a real bug, which makes
blocking the PR check the correct default. Teams that want a softer mapping can
set `--fail-on critical` to keep high findings advisory.

## What is NOT emitted in Phase 4

- `security-severity` numeric property (CodeQL-style 0.0–10.0 score) — deferred.
  Add when a customer asks for org-configurable Code Scanning thresholds; the
  renderer can append it without breaking the existing table.

## Where the mapping lives in code

`packages/cli/src/render/sarif.ts` exports `SARIF_LEVEL_BY_SEVERITY`. The CI
test `packages/cli/test/render-sarif-severity-table.test.ts` parses this
document and asserts byte-equality with that constant — keeping the
docs and the renderer from drifting.
