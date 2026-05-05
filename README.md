<p align="center">
  <img src="./assets/brand/social/readme-banner.svg" alt="hookwarden" width="100%" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/hookwarden"><img src="https://img.shields.io/npm/v/hookwarden?color=6366F1&label=npm" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/hookwarden"><img src="https://img.shields.io/npm/dm/hookwarden?color=6366F1" alt="npm downloads" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-6366F1" alt="License: Apache 2.0" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522-6366F1" alt="Node 22+" />
  <a href="https://github.com/Hookwarden/hookwarden/stargazers"><img src="https://img.shields.io/github/stars/Hookwarden/hookwarden?color=6366F1&style=flat" alt="GitHub stars" /></a>
</p>

<p align="center">
  <strong>Webhook security audit CLI.</strong> Find every signature-verification bug in your codebase in under five minutes — locally, deterministically, zero-network.
</p>

```bash
npx hookwarden scan ./your-app
```

No traffic leaves your machine. No telemetry. No SaaS sign-up.

## Why

Most webhook bugs aren't in delivery — they're in verification. A handler that accepts an unsigned payload, compares HMACs with `==`, or skips the signature check on a "test" path will silently route attacker traffic into your business logic. hookwarden walks your repo, parses every webhook handler, and labels each as **verified**, **not-verified**, or **manual-review**, with the exact file and line.

The three-state verdict matters: a "found N issues" tool can't distinguish *real* bugs from handlers that *might* be safe via a path the analyzer didn't follow. hookwarden reports `manual-review` instead of guessing — that's how the false-positive rate stays honest.

## Quickstart

```bash
# Scan a directory (terminal output, color-coded)
npx hookwarden scan ./your-app

# Emit machine-readable output for CI
npx hookwarden scan ./your-app --format json
npx hookwarden scan ./your-app --format sarif > findings.sarif

# Scope to changed files in a PR
npx hookwarden scan ./your-app --diff-only --diff-base origin/main

# Capture pre-existing findings as a baseline (for non-greenfield adoption)
npx hookwarden scan ./your-app --baseline write
```

### Real output

```
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

────────────
Found 3 critical · 0 high · 0 medium · 0 low · 0 info · 0 manual-review
Scanned in 0.0 s · 1 / 1 candidates parsed (100.0% coverage)
```

## Provider coverage

hookwarden ships rules for **six providers** as of v0.2, each with provider-doc-quoted fix guidance on every finding:

| Provider | Detections | Custom signing | Notes |
|---|---|---|---|
| **Stripe** | 9 | — | `whsec_` prefix detection; canonical `constructEvent` + manual HMAC paths |
| **GitHub** | 9 | — | `ghs_` / `github_pat_` prefix detection; `@octokit/webhooks` SDK narrowing |
| **Shopify** | 7 | — | `X-Shopify-Hmac-Sha256` + `@shopify/shopify-api` SDK |
| **Slack** | 7 | — | `'v0:' + ts + ':' + body` recipe; 5-min replay window enforcement |
| **Twilio** | 7 | ✓ | URL+sorted-params canonical-string + HMAC-SHA1 (legacy); `twilio.validateRequest` |
| **Square** | 6 | — | `URL + body` canonical-string + base64; Node + Python SDK paths |

Each detection emits one of: `verified` / `not-verified` / `manual-review`. Every YAML rule carries a quoted line from the provider's canonical security docs and a one-paragraph fix.

See the full [rule coverage matrix](./docs/rule-coverage.md).

## What's in v0.2

- **Six provider rule packs** with per-rule provider-doc-quoted fix guidance
- **Three-state verdicts** — `verified` / `not-verified` / `manual-review` (no false-confident "found" counts)
- **Output formats** — color-coded text, sorted-keys JSON envelope, SARIF 2.1.0 (round-trips through GitHub Code Scanning)
- **Exit-code matrix** — `0/1/2/3/4` with documented precedence; deterministic across CI runs
- **Suppressions** — inline `// hookwarden-disable-next-line <rule-id>`, `.hookwardenignore` (gitignore syntax), or `--baseline` for non-greenfield adoption
- **`--diff-only`** — scope to files changed against a base ref, for PR-time speed
- **`hookwarden.config.yaml`** — full config schema with three-source precedence (CLI flag > config > defaults)
- **GitHub Action** — same binary, SARIF upload to Code Scanning, threshold-based check failure ([docs](./packages/github-action/README.md))
- **Verified zero-network bundle** — every release tarball is gated by `inspect-bundle` and round-trip-tested against a real GitHub Code Scanning repo

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Clean — no findings at or above the configured threshold |
| 1 | Findings at or above `--fail-on` threshold |
| 2 | Engine error (parser crash, unreadable input) |
| 3 | Config error (malformed `hookwarden.config.yaml`) |
| 4 | Parse coverage below minimum |

Precedence: `3 > 2 > 4 > 1 > 0`. The highest applicable code wins.

### GitHub Code Scanning

Use the official Action (recommended) or wire SARIF output directly:

```yaml
# Option A: official Action (PR comment + SARIF upload, same binary)
- uses: Hookwarden/hookwarden-action@v1
  with:
    fail-on: high

# Option B: raw CLI + codeql-action upload
- run: npx hookwarden scan . --format sarif > hookwarden.sarif
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: hookwarden.sarif
```

## Architecture

This repo is a pnpm monorepo with three load-bearing packages:

| Package | What it does | License |
|---|---|---|
| [`@hookwarden/engine`](./packages/engine) | Pure-functional, browser-safe webhook handler discovery + reachability + evidence collection. No I/O. | Apache 2.0 |
| [`@hookwarden/rules`](./packages/rules) | Provider catalog + YAML rule packs + parameterized predicate factories. | Apache 2.0 |
| [`hookwarden`](./packages/cli) | The CLI binary. Parses YAML, drives the engine, renders text/JSON/SARIF. | Apache 2.0 |

The engine is intentionally I/O-free so the same code can run in a browser playground, a CLI, or a SaaS scanner without rewrites. Predicate purity is enforced by `dependency-cruiser` in CI.

## Roadmap

- **0.3 — Adoption channels.** pre-commit framework hook, Homebrew tap, Scoop / WinGet manifests; standalone binaries via `bun build --compile` (macOS arm64/x64, Linux x64/arm64, Windows x64).
- **0.4 — Remaining provider rule packs.** Adyen, Zendesk, Mailgun, SendGrid — measured against a 200-repo OSS regression corpus with a published <5% false-positive rate.
- **0.5 — Corpus + verifiable findings_delta.** `verify-changeset-delta` tool that runs every PR's rule changes against the corpus and confirms the changeset's `findings_delta` block matches the actual delta.

A separate, closed-source SaaS tier handles continuous monitoring, webhook-secret leak scanning, secret rotation for Stripe and GitHub, and SOC 2 evidence export. The CLI, engine, and rule packs in this repo are Apache 2.0 forever.

## Contributing

Bug reports, feature requests, and rule-pack PRs welcome. Adding a new provider's rule pack is a catalog edit + N rule YAMLs — see [`packages/rules/`](./packages/rules) for the existing six providers as worked examples. The factory architecture means most providers ship without any TypeScript predicate code.

For local development:

```bash
pnpm install
pnpm -r build
pnpm -r test
```

## Documentation

- [hookwarden.dev](https://hookwarden.dev)
- [Rule coverage matrix](./docs/rule-coverage.md)
- [GitHub Action docs](./packages/github-action/README.md)

## License

Apache 2.0. The CLI, engine, and rule packs are open source forever. The hosted SaaS tier is closed and lives in a separate repo.

Brand assets and the canonical mark live at [`assets/brand/`](./assets/brand/).
