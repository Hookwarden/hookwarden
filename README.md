<p align="center">
  <img src="./assets/brand/social/readme-banner.svg" alt="hookwarden" width="100%" />
</p>

<p align="center">
  <strong>The only scanner laser-focused on webhook signature verification.</strong><br />
  Local. Deterministic. Zero-network. JS/TS + Python + PHP. Five minutes from <code>npx</code> to fix.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/hookwarden"><img src="https://img.shields.io/npm/v/hookwarden?color=6366F1&label=npm&style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/hookwarden"><img src="https://img.shields.io/npm/dm/hookwarden?color=6366F1&style=flat-square" alt="npm downloads" /></a>
  <a href="https://pypi.org/project/hookwarden/"><img src="https://img.shields.io/pypi/v/hookwarden?color=6366F1&label=PyPI&style=flat-square&logo=pypi&logoColor=white" alt="PyPI version" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-6366F1?style=flat-square" alt="License: Apache 2.0" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522-6366F1?style=flat-square" alt="Node 22+" />
  <img src="https://img.shields.io/badge/PHP-%E2%89%A58.0-6366F1?style=flat-square" alt="PHP 8.0+ scanning support" />
  <img src="https://img.shields.io/badge/Python-%E2%89%A53.10-6366F1?style=flat-square" alt="Python 3.10+ scanning support" />
  <a href="https://github.com/Hookwarden/hookwarden/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Hookwarden/hookwarden/ci.yml?branch=main&color=6366F1&label=CI&style=flat-square" alt="CI" /></a>
  <a href="https://github.com/Hookwarden/hookwarden/stargazers"><img src="https://img.shields.io/github/stars/Hookwarden/hookwarden?color=6366F1&style=flat-square" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/badge/SARIF-2.1.0-6366F1?style=flat-square" alt="SARIF 2.1.0" />
</p>

<p align="center">
  <img src="./assets/brand/demo-showcase.gif" alt="hookwarden CLI demo — inventory lists webhook handlers across JS, Python and PHP with a three-state verdict (verified / manual-review / not-verified); correct SDK verification is recognized as verified; hookwarden fix rewrites an insecure === to a constant-time comparison; SARIF output with a non-zero exit for CI" width="100%" />
</p>

```bash
npx hookwarden scan ./your-app
```

No traffic leaves your machine. No telemetry. No SaaS sign-up required.

📖 **Full documentation: [docs.hookwarden.dev](https://github.com/Hookwarden/hookwarden/tree/main/apps/docs/src/content/docs)**

<!-- HOOKWARDEN_WILD_TABLE_START -->

### Found in the wild

Every Sunday at 22:00 UTC, this repo's CI runs `hookwarden` against **8 popular open-source projects** — currently cal.com, documenso, formbricks, twenty, plane, unkey, typebot, papermark ([full target list](./.github/scripts/wild-targets.txt), combined ★190k+) — to prove the scanner works on real production code.

**Latest sweep — 2026-05-28** · 4/8 projects clean (zero critical/high)

| What hookwarden caught | Severity | Found | What it means |
|---|---|---:|---|
| Raw body misuse | 🚨 critical | 2 | Body is parsed (JSON) before HMAC reads it. Signature is computed over different bytes than the sender signed — verification fails on every webhook. |
| Files the engine couldn't parse | 🟡 manual-review | 3 | Engine signal, not a user bug. Source file is syntactically broken or uses a language feature the parser doesn't understand. Scan continues; those files just don't contribute findings. |

_Hookwarden checks **11 rule classes** across **6 providers** (Stripe, GitHub, Shopify, Slack, Twilio, Square) — most of the corpus handles webhooks correctly, hence the short list. The full rule catalog lives in the [docs](https://github.com/Hookwarden/hookwarden/tree/main/apps/docs/src/content/docs/rules)._

Per-target findings are never published before responsible disclosure — see [methodology](./bugs-in-the-wild.md). To run the same scan against your own code:

```bash
npx hookwarden scan ./your-app
```

<!-- HOOKWARDEN_WILD_TABLE_END -->

---

## Why

**Every dollar of fraud that flows through a webhook starts with a verification bug — and verification bugs hide in plain sight.**

A handler that accepts an unsigned payload, compares HMACs with `==`, or skips the signature check on a `?test=true` path silently routes attacker traffic into your business logic. The bug is one line in a 50K-line app, and it looks plausible — not the shape general-purpose SAST tools are tuned to flag. They were built for SQL injection and prototype pollution; webhook verification falls between their default rule packs.

hookwarden does one thing. It walks your repo, parses every webhook handler across 11 frameworks, and labels each one **verified**, **not-verified**, or **manual-review** — with the exact file, line, and a fix quoted from provider docs. The catalog (Stripe, GitHub, Shopify, Slack, Twilio, Square) encodes signature quirks no generic scanner has the surface area to know: Stripe's 5-minute timestamp tolerance, Slack's `v0:${ts}:${body}` scheme, Twilio's SHA-1 outlier.

**The three-state verdict is not a hedge.** `manual-review` is what you get when hookwarden can't *prove* safety or unsafety from the source alone — a handler inside a middleware chain the analyzer couldn't unroll, say. It's how the false-positive rate stays honest (<5%, measured against a 200-repo OSS corpus). A tool that reports every gray area as a bug isn't a security tool; it's noise. → [How the verdict works](https://github.com/Hookwarden/hookwarden/blob/main/apps/docs/src/content/docs/rules/index.mdx)

---

## Install

```bash
npx hookwarden scan .   # works everywhere, no install
```

Or install natively:

| OS | Recommended | Alternates |
|---|---|---|
| **Linux** | `brew install Hookwarden/tap/hookwarden` | `npm i -g hookwarden` · `pip install hookwarden` · direct binary |
| **macOS** | `brew install Hookwarden/tap/hookwarden` | `npm i -g hookwarden` · `npx hookwarden` |
| **Windows** | `scoop bucket add hookwarden https://github.com/Hookwarden/scoop-bucket && scoop install hookwarden` | `npm i -g hookwarden` · `pip install hookwarden` |

Node 22+ is required for the npm/`npx`/macOS-brew paths; the standalone binaries (Linux x64/arm64, Windows x64) bundle the runtime. Direct binary downloads are intentionally unsigned (Gatekeeper / SmartScreen will warn) — prefer `brew` / `scoop` / `npm` / `pip`, which verify by SHA-256. → [Install guide](https://github.com/Hookwarden/hookwarden/tree/main/apps/docs/src/content/docs)

---

## Quickstart

```bash
# Scan — no install required
npx hookwarden scan ./your-app

# Fail CI on high+ findings, machine-readable output
npx hookwarden scan ./your-app --fail-on high --format json
# Exit codes: 0 clean · 1 findings at threshold · 2 engine error · 3 config error · 4 parse coverage below floor

# Adopt on a non-greenfield repo — accept existing findings, gate only NEW ones
npx hookwarden scan ./your-app --baseline write
npx hookwarden scan ./your-app --fail-on high

# List every detected webhook handler (no rules run) — useful for audits
npx hookwarden inventory ./your-app
```

`--diff-only`, `--provider stripe,github` (phased rollout), `--include`/`--exclude` globs, `--strict-suppressions`, repo-level `hookwarden.config.yaml`, and more: `npx hookwarden --help` and the [CLI docs](https://github.com/Hookwarden/hookwarden/blob/main/apps/docs/src/content/docs/cli/ci.mdx).

---

## Auto-fix

hookwarden doesn't just name the fix — it applies it. The `fix` subcommand mechanically rewrites the `safety: safe` subset across JS/TS, Python, and PHP (10 rules: timing-unsafe comparisons → `crypto.timingSafeEqual` / `hmac.compare_digest` / `hash_equals`, and raw-body misuse). The other 35 rules are architectural and emit per-finding fix prose instead.

```bash
npx hookwarden fix ./your-app           # dry-run — prints a unified diff, writes nothing
npx hookwarden fix ./your-app --write   # atomic staging, re-scan, then rename into place
```

Every rewrite lands in a staging dir and is re-scanned before replacing the original; the fixer never edits inside strings or comments. → [hookwarden fix](https://github.com/Hookwarden/hookwarden/blob/main/apps/docs/src/content/docs/cli/fix.mdx) · [Safety levels](https://github.com/Hookwarden/hookwarden/blob/main/apps/docs/src/content/docs/cli/safety-levels.mdx)

---

## Real output

Captured verbatim — each line is what you'll see in your terminal, not a mockup. One Express middleware bug produces **three** findings, because that single mistake violates three distinct invariants; fixing one (re-ordering the middleware) clears all three:

```
$ hookwarden scan ./your-app
× critical  server.js:10:1  stripe/express-middleware-ordering  not-verified
  Express webhook handler for Stripe has `express.json()` registered before the webhook route. JSON
  middleware consumes the request body; by the time the Stripe handler runs, the raw bytes used for
  HMAC are gone and `stripe.webhooks.constructEvent` cannot reproduce the signature.
  fix › register `express.json()` AFTER the webhook route, OR mount `express.raw(...)` on the path only.
  docs › https://docs.stripe.com/webhooks#verify-events

× critical  server.js:10:1  stripe/missing-signature-verification  not-verified
  Stripe webhook handler does not appear to verify the signature header before processing the event …

× critical  server.js:10:1  stripe/raw-body-misuse  not-verified
  Stripe webhook handler reads the signature header but does not appear to receive the body as raw bytes …

────────────
Found 3 critical · 0 high · 0 medium · 0 low · 0 info · 0 manual-review — 1 webhook handler across 1 file
Scanned in 3 ms · 1 / 1 candidates parsed (100.0% coverage)
```

| Glyph | Severity | SARIF level | Counts toward `--fail-on`? |
|---|---|---|---|
| `×` | `critical` | `error` | yes |
| `!` | `high` | `error` | yes |
| `▲` | `medium` | `warning` | yes |
| `·` | `low` | `note` | yes |
| `i` | `info` | `note` | no — informational (e.g. `library-verified`) |

The `state` column is the three-state verdict. Output is also available as byte-stable JSON and SARIF 2.1.0 (round-trips through GitHub Code Scanning, dedupes via `partialFingerprints`). → [Output formats & JSON schema](https://github.com/Hookwarden/hookwarden/blob/main/apps/docs/src/content/docs/cli/ci.mdx)

---

## Languages, frameworks & providers

**3 languages · 11 frameworks · 6 providers · 45 rules.** JS/TS parse with Babel; Python and PHP with tree-sitter (WASM).

| Language | Frameworks |
|---|---|
| **JavaScript / TypeScript** | Express · Hono · Fastify · Next.js |
| **Python** | Flask · FastAPI · Django |
| **PHP** | Laravel · Symfony · Slim · vanilla single-file |

<p align="center">
  <a href="https://github.com/Hookwarden/hookwarden/blob/main/apps/docs/src/content/docs/rules/stripe.mdx"><img src="https://img.shields.io/badge/Stripe-6366F1?style=for-the-badge&logo=stripe&logoColor=white" alt="Stripe" /></a>
  <a href="https://github.com/Hookwarden/hookwarden/blob/main/apps/docs/src/content/docs/rules/github.mdx"><img src="https://img.shields.io/badge/GitHub-6366F1?style=for-the-badge&logo=github&logoColor=white" alt="GitHub" /></a>
  <a href="https://github.com/Hookwarden/hookwarden/blob/main/apps/docs/src/content/docs/rules/shopify.mdx"><img src="https://img.shields.io/badge/Shopify-6366F1?style=for-the-badge&logo=shopify&logoColor=white" alt="Shopify" /></a>
  <a href="https://github.com/Hookwarden/hookwarden/blob/main/apps/docs/src/content/docs/rules/slack.mdx"><img src="https://img.shields.io/badge/Slack-6366F1?style=for-the-badge&logo=slack&logoColor=white" alt="Slack" /></a>
  <a href="https://github.com/Hookwarden/hookwarden/blob/main/apps/docs/src/content/docs/rules/twilio.mdx"><img src="https://img.shields.io/badge/Twilio-6366F1?style=for-the-badge&logo=twilio&logoColor=white" alt="Twilio" /></a>
  <a href="https://github.com/Hookwarden/hookwarden/blob/main/apps/docs/src/content/docs/rules/square.mdx"><img src="https://img.shields.io/badge/Square-6366F1?style=for-the-badge&logo=square&logoColor=white" alt="Square" /></a>
</p>

Every rule carries fix guidance quoted from the provider's canonical security docs. Full per-rule reference and coverage matrix: **[docs.hookwarden.dev/rules](https://github.com/Hookwarden/hookwarden/blob/main/apps/docs/src/content/docs/rules/index.mdx)**.

---

## CI integration

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

Uploads SARIF to Code Scanning automatically; findings appear as PR annotations. Raw-CLI + SARIF-upload recipe, exit-code matrix, and diff-only PR scans: → [CI integration guide](https://github.com/Hookwarden/hookwarden/blob/main/apps/docs/src/content/docs/cli/ci.mdx).

---

## vs. other tools

hookwarden is **specialized on purpose.** The general-purpose scanners below are excellent — they're just not in this fight.

| Tool | What it does well | Webhook verification |
|---|---|---|
| **semgrep** | General-purpose SAST; flexible rules | Low signal — generic matching misses body-parsing order, timing-safe paths, SDK flows |
| **snyk Code** | Broad vuln detection (paid SaaS) | No webhook rules; doesn't model HMAC reachability |
| **GitGuardian / TruffleHog** | Secret-leak detection | Finds hardcoded secrets; doesn't audit whether verification is correct |
| **Datadog Static Analysis** | Broad SAST; good cloud signal | No webhook specialization; low-signal for this bug class |
| **hookwarden** | Webhook verification logic only | 45 rules, 6 providers, three-state verdicts, <5% FP on a 200-repo corpus |

hookwarden is **not** a general-purpose SAST or DAST scanner — it won't find XSS, SQL injection, or memory-safety bugs, and it isn't trying to. Keep semgrep, CodeQL, or your DAST for those. Already running one? hookwarden is additive — it finds the one class of bug they weren't built to catch.

---

## Architecture

A pnpm monorepo with a strict, CI-enforced dependency boundary: the engine is pure-functional (no I/O, no filesystem, no network), so the same engine runs in the CLI, in CI, and — eventually — in a browser playground without modification.

| Package | Purpose | License |
|---|---|---|
| [`@hookwarden/engine`](./packages/engine) | Handler discovery, reachability analysis, evidence collection. Pure-functional, browser-safe. | Apache 2.0 |
| [`@hookwarden/rules`](./packages/rules) | Provider catalog, YAML rule packs, parameterized predicate factories. | Apache 2.0 |
| [`hookwarden`](./packages/cli) | CLI binary — reads config, drives the engine, renders text/JSON/SARIF. | Apache 2.0 |

`dependency-cruiser` enforces the engine's I/O boundary in every PR.

---

## Roadmap

- **✅ v0.5 — `hookwarden fix`** auto-remediation (mechanical AST rewrites, safe/manual-only per rule).
- **✅ v0.4 — PHP support** (Laravel, Symfony, Slim, vanilla) + `--provider` filter for phased rollout.
- **v0.6 — more providers** (Adyen, Zendesk, Mailgun) — each measured against the OSS corpus with a published FP rate.
- **v0.7 — corpus integrity** — every rule-pack PR's findings-delta verified against the full corpus before merge.

---

## Contributing

Rule-pack PRs are the highest-value contribution — adding a provider is a catalog edit plus N rule YAMLs, no new TypeScript in most cases. See the existing six in [`packages/rules/rules/`](./packages/rules/rules) as worked examples, and [CONTRIBUTING.md](./CONTRIBUTING.md).

```bash
pnpm install && pnpm -r build && pnpm -r test
```

Bug reports & feature requests: [open an issue](https://github.com/Hookwarden/hookwarden/issues). Docs: [docs.hookwarden.dev](https://github.com/Hookwarden/hookwarden/tree/main/apps/docs/src/content/docs) · [hookwarden.dev](https://hookwarden.dev).

<!-- ALL-CONTRIBUTORS-LIST:START -->
<!-- ALL-CONTRIBUTORS-LIST:END -->

> To add yourself after a merged PR, comment `@all-contributors please add @<username> for <contribution>`.

---

## Star history

<a href="https://star-history.com/#Hookwarden/hookwarden&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Hookwarden/hookwarden&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Hookwarden/hookwarden&type=Date" />
    <img alt="Star history chart for Hookwarden/hookwarden" src="https://api.star-history.com/svg?repos=Hookwarden/hookwarden&type=Date" />
  </picture>
</a>

---

## License

Apache 2.0 — see [`LICENSE`](./LICENSE). The CLI, engine, and rule packs are open source and will stay that way. A separate closed-source SaaS tier handles continuous monitoring, secret-leak scanning, automated rotation, and SOC 2 evidence export — [hookwarden.dev](https://hookwarden.dev).
