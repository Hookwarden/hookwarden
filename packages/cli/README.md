<p align="center">
  <img src="https://raw.githubusercontent.com/Hookwarden/hookwarden/main/assets/brand/social/readme-banner.svg" alt="hookwarden" width="100%" />
</p>

<p align="center">
  <strong>Webhook verification audit for JS/TS and Python codebases. Local. Deterministic. Zero-network.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/hookwarden"><img src="https://img.shields.io/npm/v/hookwarden?color=4F46E5&label=npm&style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/hookwarden"><img src="https://img.shields.io/npm/dm/hookwarden?color=4F46E5&style=flat-square" alt="npm downloads" /></a>
  <a href="https://github.com/Hookwarden/hookwarden/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-4F46E5?style=flat-square" alt="License: Apache 2.0" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522-4F46E5?style=flat-square" alt="Node 22+" />
  <a href="https://github.com/Hookwarden/hookwarden/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Hookwarden/hookwarden/ci.yml?branch=main&color=4F46E5&label=CI&style=flat-square" alt="CI" /></a>
  <a href="https://github.com/Hookwarden/hookwarden/stargazers"><img src="https://img.shields.io/github/stars/Hookwarden/hookwarden?color=4F46E5&style=flat-square" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-4F46E5?style=flat-square" alt="TypeScript strict" />
</p>

<br />

```bash
npx hookwarden scan ./your-app
```

No traffic leaves your machine. No telemetry. No SaaS sign-up required.

---

## Contents

- [Why](#why)
- [Quickstart](#quickstart)
- [Real output](#real-output)
- [Provider coverage](#provider-coverage)
- [CI integration](#ci-integration)
- [Architecture](#architecture)
- [vs. other tools](#vs-other-tools)
- [Advanced usage](#advanced-usage)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Why

Most webhook bugs are not in delivery — they're in verification. A handler that accepts an unsigned payload, compares HMACs with `==`, or skips the signature check on a `?test=true` path will silently route attacker traffic into your business logic. The attack surface is real, the bugs are common, and static analysis tools that weren't built for this miss most of them.

hookwarden walks your repo, parses every webhook handler across Express, Hono, Fastify, Next.js, Flask, FastAPI, and Django, and labels each one **verified**, **not-verified**, or **manual-review** — with the exact file, line, and a fix drawn verbatim from provider documentation.

**The three-state verdict is not a hedge.** `manual-review` is what you get when hookwarden can't prove safety or unsafety from the source alone — a handler inside a middleware chain that the analyzer couldn't fully unroll, for example. It's how the false-positive rate stays honest. A tool that reports every gray area as a bug is not a security tool; it's noise.

---

## 🚀 Quickstart

```bash
# First use — no install required
npx hookwarden scan ./your-app

# JSON envelope for CI pipelines
npx hookwarden scan ./your-app --format json

# SARIF for GitHub Code Scanning
npx hookwarden scan ./your-app --format sarif > findings.sarif

# Scope to files changed in a PR
npx hookwarden scan ./your-app --diff-only --diff-base origin/main

# Snapshot pre-existing findings as a baseline (non-greenfield adoption)
npx hookwarden scan ./your-app --baseline write
```

Or install permanently:

```bash
npm install -g hookwarden          # global
npm install --save-dev hookwarden  # dev dependency (CI-pinnable)
```

---

## Real output

**Clean scan — exits 0:**

```
hookwarden scan ./your-app

✓  Scanned 24 candidates · 24 parsed (100.0% coverage) · 0 findings
```

**Scan with a bug — exits 1:**

```
hookwarden scan ./your-app

CRITICAL
────────

  server.js:10:1
    stripe/express-middleware-ordering  [not-verified]
    Express webhook handler for Stripe has `express.json()` registered before
    the webhook route. JSON middleware consumes the request body; by the time
    the Stripe handler runs, the raw bytes used for HMAC are gone.

    Fix: register `express.json()` AFTER the webhook route, OR mount
    `express.raw({ type: 'application/json' })` only on the webhook path.
    ↳ https://stripe.com/docs/webhooks/signatures

HIGH
────

  handlers/slack.ts:34:1
    slack/missing-timestamp-validation  [not-verified]
    Slack handler does not enforce the 5-minute replay window. The
    `X-Slack-Request-Timestamp` header is present but not compared against
    the current time before signature verification proceeds.

    Fix: reject requests where abs(Date.now()/1000 - ts) > 300 before
    computing the `v0:${ts}:${body}` signing string.
    ↳ https://api.slack.com/authentication/verifying-requests-from-slack

────────────
Found 1 critical · 1 high · 0 medium · 0 low · 0 info · 0 manual-review
Scanned in 0.3 s · 24 / 24 candidates parsed (100.0% coverage)
```

**JSON envelope shape:**

```json
{
  "schema_version": "1.0",
  "engine": { "version": "0.2.0", "commit_sha": null },
  "rule_pack": { "version": "0.2.0", "content_hash": "51c219..." },
  "scan": {
    "counts": {
      "active":     { "critical": 1, "high": 1, "medium": 0, "low": 0, "info": 0 },
      "suppressed": { "critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0 }
    },
    "findings": [
      {
        "rule_id": "stripe/express-middleware-ordering",
        "severity": "critical",
        "state": "not-verified",
        "provider": "stripe",
        "file_path": "server.js",
        "location": { "line": 10, "col": 1 },
        "finding_id": "stripe/express-middleware-ordering@d603a04...",
        "primary_location_line_hash": "d603a04...",
        "message": "Express webhook handler for Stripe has...",
        "redacted_snippet": "app.use(express.json())\napp.post('/webhook', ...",
        "suppressed": null
      }
    ],
    "scanned_at": "2026-05-05T18:31:33.653Z",
    "parsed_files_count": 1,
    "parse_candidates_count": 1
  },
  "suppressions": { "applied": [], "stale": [] }
}
```

Sorted keys, schema-versioned, byte-stable across runs (modulo `scanned_at`). SARIF output round-trips through GitHub Code Scanning and deduplicates via `partialFingerprints` on re-upload.

---

## 🔐 Provider coverage

45 rules across 6 providers as of v0.2. Every rule carries fix guidance quoted verbatim from the provider's canonical security documentation.

| Provider | Rules | Detection types | Custom predicate |
|---|---|---|---|
| [**Stripe**](https://github.com/Hookwarden/hookwarden/tree/main/packages/rules/rules/stripe) | 9 | missing-sig-verif, timing-unsafe, raw-body, missing-timestamp, wrong-hmac, unreachable-verif, hardcoded-secret (`whsec_`), library-verified | — |
| [**GitHub**](https://github.com/Hookwarden/hookwarden/tree/main/packages/rules/rules/github) | 9 | missing-sig-verif, timing-unsafe, raw-body, missing-timestamp, wrong-hmac, unreachable-verif, hardcoded-secret (`ghs_`, `github_pat_`), library-verified | — |
| [**Shopify**](https://github.com/Hookwarden/hookwarden/tree/main/packages/rules/rules/shopify) | 7 | missing-sig-verif, timing-unsafe, raw-body, missing-timestamp (info), wrong-hmac, unreachable-verif, library-verified | — |
| [**Slack**](https://github.com/Hookwarden/hookwarden/tree/main/packages/rules/rules/slack) | 7 | missing-sig-verif, timing-unsafe, raw-body, missing-timestamp (high), wrong-hmac, unreachable-verif, library-verified | Parameterized `timestamp_dot_body` recipe |
| [**Twilio**](https://github.com/Hookwarden/hookwarden/tree/main/packages/rules/rules/twilio) | 7 | missing-sig-verif, timing-unsafe, raw-body, missing-timestamp (info), wrong-hmac, unreachable-verif, library-verified | `predicates/custom/twilio-signing.ts` — URL+sorted-params canonical-string + HMAC-SHA1 |
| [**Square**](https://github.com/Hookwarden/hookwarden/tree/main/packages/rules/rules/square) | 6 | missing-sig-verif, timing-unsafe, raw-body, wrong-hmac, unreachable-verif, library-verified | Parameterized `custom_field_tuple` recipe |

Full per-rule applicability matrix: [`docs/rule-coverage.md`](https://github.com/Hookwarden/hookwarden/blob/main/docs/rule-coverage.md).

---

## CI integration

### GitHub Action (recommended)

```yaml
# .github/workflows/hookwarden.yml
name: hookwarden
on: [pull_request, push]
permissions:
  contents: read
  pull-requests: write
  security-events: write
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: Hookwarden/hookwarden-action@v1
        with:
          fail-on: high
```

Uploads SARIF to Code Scanning automatically. Findings appear as PR annotations.

### Raw CLI + SARIF upload

```yaml
- uses: actions/setup-node@v4
  with: { node-version: '22' }
- run: npx hookwarden scan . --format sarif > hookwarden.sarif
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: hookwarden.sarif
```

SARIF severity mapping: `critical`/`high` → `error` · `medium` → `warning` · `low`/`info` → `note`.

---

## Architecture

hookwarden is a pnpm monorepo with three load-bearing packages and a strict dependency boundary enforced in CI.

```
@hookwarden/rules  →  @hookwarden/engine  →  hookwarden CLI
(YAML data +          (pure-functional,       (binary, renders
 predicate factories)   I/O-free)               output)
```

| Package | Purpose | License |
|---|---|---|
| [`@hookwarden/engine`](https://github.com/Hookwarden/hookwarden/tree/main/packages/engine) | Webhook handler discovery, reachability analysis, evidence collection. Pure-functional, browser-safe — no I/O, no filesystem, no network. | Apache 2.0 |
| [`@hookwarden/rules`](https://github.com/Hookwarden/hookwarden/tree/main/packages/rules) | Provider catalog, YAML rule packs, parameterized predicate factories. | Apache 2.0 |
| [`hookwarden`](https://github.com/Hookwarden/hookwarden/tree/main/packages/cli) | CLI binary. Reads config, drives the engine, renders text/JSON/SARIF. | Apache 2.0 |

The engine's I/O boundary is the architectural load-bearing constraint. The same engine runs in the CLI, in CI, and — eventually — in a browser playground without modification. `dependency-cruiser` enforces the boundary in every PR.

---

## vs. other tools

hookwarden is specialized. These tools are not competitors — they're solving different scopes of the problem.

| Tool | What it does well | Webhook verification coverage |
|---|---|---|
| **semgrep** | General-purpose SAST; flexible rule authoring | Low signal — generic pattern matching misses body-parsing ordering, timing-safe comparison paths, and SDK-specific verification flows |
| **snyk Code** | Broad vulnerability detection in paid SaaS | No webhook-specific rules; doesn't model HMAC reachability |
| **GitGuardian** | Secret leak detection in git history and CI | Finds hardcoded secrets; does not audit whether verification logic is correct |
| **TruffleHog** | Secret scanning across sources | Same as GitGuardian — leak focus, not logic focus |
| **Datadog Static Analysis** | Broad SAST; good AWS/cloud signal | No webhook verification specialization; high false-positive rate for this class of bug |
| **hookwarden** | Webhook verification logic only | 45 rules, 6 providers, three-state verdicts, <5% FP target measured against a 200-repo OSS corpus |

If you're already running semgrep or snyk: hookwarden is additive, not a replacement. It finds the class of bug those tools were not built to find.

---

## Advanced usage

<details>
<summary>Suppression — inline, .hookwardenignore, and baseline</summary>

Three suppression mechanisms, in order of preference:

**Inline** — best for one-off cases; the comment is grep-able evidence in code review:

```ts
// hookwarden-disable-next-line stripe/missing-signature-verification
app.post('/webhook', rawBodyHandler);
```

**`.hookwardenignore`** — gitignore syntax; best for path-scoped suppression:

```gitignore
__tests__/
fixtures/**/*.spec.ts
mocks/
```

**Baseline** — best for adopting on a non-greenfield codebase without failing CI on day one:

```bash
# Capture current state
hookwarden scan . --baseline write
# Subsequent runs suppress baselined findings; new findings still fail
hookwarden scan .
```

`--format json` reports each finding's suppression source (`inline` / `ignorefile` / `baseline`) so suppressions are auditable.

</details>

<details>
<summary>Exit code matrix</summary>

| Code | Meaning |
|------|---------|
| `0` | Clean — no findings at or above the configured `--fail-on` threshold |
| `1` | Findings at or above threshold |
| `2` | Engine error (parser crash, unreadable input) |
| `3` | Config error (malformed `hookwarden.config.yaml`) |
| `4` | Parse coverage below `parse_coverage_min` |

Precedence: `3 > 2 > 4 > 1 > 0`. The highest applicable code wins; use this for branching logic in CI pipelines.

</details>

<details>
<summary>Configuration schema</summary>

Drop a `hookwarden.config.yaml` at your project root (or any ancestor directory):

```yaml
schema_version: '1.0'
fail_on: high                         # critical | high | medium | low | info
parse_coverage_min: 0.9               # fail if < 90% of candidates parsed
baseline:
  enabled: true
  path: .hookwarden.baseline.json
```

Precedence: CLI flag > `hookwarden.config.yaml` > built-in defaults.

Inventory mode (lists detected handlers without running rules):

```bash
hookwarden inventory ./your-app
```

</details>

<details>
<summary>SARIF severity mapping</summary>

| hookwarden severity | SARIF `level` | GitHub Code Scanning |
|---|---|---|
| `critical` | `error` | Blocks PR merge (if branch protection configured) |
| `high` | `error` | Blocks PR merge |
| `medium` | `warning` | Visible annotation, non-blocking |
| `low` | `note` | Visible annotation |
| `info` | `note` | Visible annotation |

Re-uploading the same scan deduplicates via SARIF `partialFingerprints`. Full mapping table: [`packages/cli/docs/sarif-severity-mapping.md`](https://github.com/Hookwarden/hookwarden/blob/main/packages/cli/docs/sarif-severity-mapping.md).

</details>

---

## Roadmap

**v0.3 — Distribution.** pre-commit hook, Homebrew tap, Scoop/WinGet manifests, standalone binaries (macOS arm64/x64, Linux x64/arm64, Windows x64).

**v0.4 — More providers.** Adyen, Zendesk, Mailgun, SendGrid — each measured against the 200-repo OSS regression corpus before release, with a published false-positive rate.

**v0.5 — Corpus integrity.** `verify-changeset-delta` — every PR's rule changes run against the full corpus and the `findings_delta` block must match the actual delta before merge.

---

## Contributing

Rule-pack PRs are the highest-value contribution. Adding a new provider is a catalog edit plus N rule YAMLs — the factory architecture means most providers ship without any new TypeScript. See the existing six providers in [`packages/rules/rules/`](https://github.com/Hookwarden/hookwarden/tree/main/packages/rules/rules) as worked examples.

Bug reports and feature requests: [open an issue](https://github.com/Hookwarden/hookwarden/issues).

Local development:

```bash
pnpm install
pnpm -r build
pnpm -r test
```

---

## Documentation

- [hookwarden.dev](https://hookwarden.dev)
- [Rule coverage matrix](https://github.com/Hookwarden/hookwarden/blob/main/docs/rule-coverage.md)
- [GitHub Action docs](https://github.com/Hookwarden/hookwarden/tree/main/packages/github-action)

---

## License

Apache 2.0. The CLI, engine, and rule packs in this repo are open source and will remain so. A separate closed-source SaaS tier handles continuous monitoring, secret leak scanning, automated rotation, and SOC 2 evidence export — [hookwarden.dev](https://hookwarden.dev).
