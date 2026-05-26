<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/Hookwarden/hookwarden@main/assets/brand/social/readme-banner.svg" alt="hookwarden" width="100%" />
</p>

<p align="center">
  <strong>The only scanner laser-focused on webhook signature verification.</strong><br />
  Local. Deterministic. Zero-network. JS/TS + Python + PHP. Five minutes from <code>npx</code> to fix.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/hookwarden"><img src="https://img.shields.io/npm/v/hookwarden?color=6366F1&label=npm&style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/hookwarden"><img src="https://img.shields.io/npm/dm/hookwarden?color=6366F1&style=flat-square" alt="npm downloads" /></a>
  <a href="https://pypi.org/project/hookwarden/"><img src="https://img.shields.io/pypi/v/hookwarden?color=6366F1&label=PyPI&style=flat-square" alt="PyPI version" /></a>
  <a href="https://github.com/Hookwarden/hookwarden/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-6366F1?style=flat-square" alt="License: Apache 2.0" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522-6366F1?style=flat-square" alt="Node 22+" />
  <img src="https://img.shields.io/badge/PHP-%E2%89%A58.0-6366F1?style=flat-square" alt="PHP 8.0+ scanning support" />
  <img src="https://img.shields.io/badge/Python-%E2%89%A53.10-6366F1?style=flat-square" alt="Python 3.10+ scanning support" />
  <a href="https://github.com/Hookwarden/hookwarden/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Hookwarden/hookwarden/ci.yml?branch=main&color=6366F1&label=CI&style=flat-square" alt="CI" /></a>
  <a href="https://github.com/Hookwarden/hookwarden/stargazers"><img src="https://img.shields.io/github/stars/Hookwarden/hookwarden?color=6366F1&style=flat-square" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/badge/SARIF-2.1.0-6366F1?style=flat-square" alt="SARIF 2.1.0" />
</p>

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/Hookwarden/hookwarden@main/assets/brand/demo-showcase.gif" alt="hookwarden CLI demo — inventory lists webhook handlers across JS, Python and PHP with a three-state verdict (verified / manual-review / not-verified); correct SDK verification is recognized as verified; hookwarden fix rewrites an insecure === to a constant-time comparison; SARIF output with a non-zero exit for CI" width="100%" />
</p>

```bash
npx hookwarden scan ./your-app
```

No traffic leaves your machine. No telemetry. No SaaS sign-up required.

---

## 📚 Contents

- [💡 Why](#-why)
- [📦 Install](#-install)
- [🚀 Quickstart](#-quickstart)
- [🛠 Auto-fix (v0.5)](#-auto-fix-v05)
- [📺 Real output](#-real-output)
- [🌐 Languages & frameworks](#-languages--frameworks)
- [🔐 Provider coverage](#-provider-coverage)
- [🤖 CI integration](#-ci-integration)
- [🏗 Architecture](#-architecture)
- [🆚 vs. other tools](#-vs-other-tools)
- [🛠 Advanced usage](#-advanced-usage)
- [🗺 Roadmap](#-roadmap)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

---

## 💡 Why

**Every dollar of fraud loss that flows through a webhook starts with a verification bug — and verification bugs hide in plain sight.**

A handler that accepts an unsigned payload, compares HMACs with `==`, or skips the signature check on a `?test=true` path will silently route attacker traffic into your business logic. The bug is one line of code in a 50K-line app, and the code looks plausible — not the shape general-purpose SAST tools are tuned to flag. They were built to catch SQL injection and prototype pollution; webhook verification falls between their default rule packs.

Hookwarden does one thing. It walks your repo, parses every webhook handler across 11 frameworks (Express, Hono, Fastify, Next.js, Flask, FastAPI, Django, Laravel, Symfony, Slim, and vanilla-PHP), and labels each one **verified**, **not-verified**, or **manual-review** — with the exact file, line, and a fix drawn verbatim from provider documentation. The provider catalog (Stripe, GitHub, Shopify, Slack, Twilio, Square — and growing) encodes signature-format quirks no generic scanner has the surface area to know: Stripe uses HMAC-SHA256 with a 5-minute timestamp tolerance; Slack uses `v0:${ts}:${body}` not raw-body; Twilio is the SHA1 outlier the rest of the catalog has to accommodate.

**The three-state verdict is not a hedge.** `manual-review` is what you get when hookwarden can't prove safety or unsafety from the source alone — a handler inside a middleware chain that the analyzer couldn't fully unroll, for example. It's how the false-positive rate stays honest. A tool that reports every gray area as a bug is not a security tool; it's noise.

---

## 📦 Install

```bash
npx hookwarden scan .   # works everywhere, no install
```

Or install natively via your OS package manager:

| OS | Recommended | Alternates |
|---|---|---|
| **Linux** | `brew install Hookwarden/tap/hookwarden` | `npm i -g hookwarden` · `pip install hookwarden` · direct binary |
| **macOS** | `brew install Hookwarden/tap/hookwarden` | `npm i -g hookwarden` · `npx hookwarden` (no install) |
| **Windows** | `scoop bucket add hookwarden https://github.com/Hookwarden/scoop-bucket && scoop install hookwarden` | `npm i -g hookwarden` · `pip install hookwarden` |

> Same `brew install` on macOS and Linux. The Linux formula pulls the bun-compiled standalone binary; the macOS formula installs the published npm tarball under `libexec` and symlinks the `hookwarden` command into your `PATH` — same scan engine, same rule pack, same outputs. The macOS path adds `node` as a runtime dep (brew handles transparently); no signed darwin binary ships, so direct-download from a GitHub release will trigger Gatekeeper — install via `brew` or `npx` instead.
>
> Windows users downloading the `.exe` directly from a GitHub release will see a SmartScreen "Windows protected your PC" warning on first launch — hookwarden binaries ship intentionally unsigned. Click `More info → Run anyway`, or use **Scoop / WinGet / npm / pip** instead — each verifies the artifact by SHA-256 before exec, no SmartScreen friction.

Node 22+ is required for the npm/`npx` path and for the macOS brew install. The standalone binaries (Linux x64/arm64, Windows x64) bundle the Node runtime.

---

## 🚀 Quickstart

**First use — no install required:**
```bash
npx hookwarden scan ./your-app
```

**Make CI fail on high+ findings:**
```bash
npx hookwarden scan ./your-app --fail-on high --format json
# Exit codes: 0 clean · 1 findings at threshold · 2 engine error · 3 config error · 4 parse coverage below floor.
# JSON envelope is byte-stable — diff-safe between PRs.
```

**PR-scoped scan + CI gate (default branch = origin/main):**
```bash
npx hookwarden scan ./your-app \
  --diff-only \
  --diff-base origin/main \
  --fail-on high
```

**Upload to GitHub Code Scanning (findings show in the Security tab):**
```bash
npx hookwarden scan ./your-app --format sarif > findings.sarif
gh api -X POST /repos/$REPO/code-scanning/sarifs \
  -F sarif=@findings.sarif -F ref=$GITHUB_REF
# SARIF round-trips through GitHub Code Scanning; re-upload deduplicates
# via `partialFingerprints` so the same finding doesn't surface twice.
```

**Non-greenfield adoption — accept existing findings, gate only NEW ones:**
```bash
# One-time: capture the current state as a baseline (written to .hookwarden.baseline.json).
npx hookwarden scan ./your-app --baseline write
git add .hookwarden.baseline.json && git commit -m "chore: hookwarden baseline"

# All subsequent scans auto-read the baseline; only new findings are reported.
npx hookwarden scan ./your-app --fail-on high
```

**List every detected webhook handler (no rule evaluation):**
```bash
npx hookwarden inventory ./your-app
# Useful for compliance audits — "what webhook handlers exist in this codebase
# and which provider/framework does each route to?". No rules run; just inventory.
```

**Repo-level config via `hookwarden.config.yaml`:**
```bash
# Auto-discovered when placed at the repo root; or pass explicitly:
npx hookwarden scan ./your-app --config ./hookwarden.config.yaml

# Precedence: CLI flag > HOOKWARDEN_<KEY> env var > config file > built-in default.
```

**Phased rollout — gate CI on one provider at a time:**
```bash
npx hookwarden scan ./your-app --provider stripe --fail-on high
# Only Stripe rules run; GitHub / Shopify / Slack / Twilio / Square findings stay quiet.
# Comma-separated for multiple: --provider stripe,github
# Useful when a security team rolls out coverage stage-by-stage across teams —
# adopters don't get a 100-finding PR on day one.
```

**Monorepo scoping — exclude / include paths from the command line:**
```bash
# Skip legacy + vendor trees (layered on top of .gitignore + default test exclusions):
npx hookwarden scan ./your-app --exclude 'packages/legacy/**,vendor/**'

# Scope to one workspace only:
npx hookwarden scan ./your-app --include 'packages/api/**'

# Both flags compose — include narrows first, then exclude removes. Gitignore-style globs.
```

**Strict suppressions (compliance teams):**
```bash
npx hookwarden scan ./your-app --strict-suppressions
# Stale inline `// hookwarden-ignore-next-line` suppressions promote to ERRORS
# instead of warnings. Forces audit hygiene: a fix that removes the bug must also
# remove its suppression — otherwise CI breaks.
```

**Tune parse-coverage floor (for noisy / generated-code repos):**
```bash
npx hookwarden scan ./your-app --min-parse-coverage 0.85
# Default 0.95. Lower for monorepos with generated TS / JSX edge cases where
# the parser occasionally bails. Below this floor, the scanner exits 4 — by design.
```

See [Install](#-install) for permanent install via npm, Homebrew, Scoop, or PyPI. Full flag reference: `npx hookwarden --help`.

---

## 🛠 Auto-fix (v0.5)

hookwarden doesn't just tell you the fix — it applies it. The `fix` subcommand mechanically rewrites the `safety: safe` subset of findings across JS/TS, Python, and PHP.

```bash
# Dry-run (default) — prints a unified diff, writes nothing
npx hookwarden fix ./your-app

# Apply via atomic-staging path, re-scan touched files, then rename into place
npx hookwarden fix ./your-app --write
```

**Three safety modes:**

- `--mode safe` (default) — only applies rules marked `safety: safe` in the rule pack (10 rules: timing-unsafe comparisons across all 3 langs, raw-body misuse across JS/TS + PHP). Constant-time `crypto.timingSafeEqual` / `hmac.compare_digest` / `hash_equals` replacements; `req.body` → `req.rawBody`; `$_POST` / `Input::all` → `file_get_contents("php://input")`.
- `--mode all` — applies `safe` plus `unsafe` rules. Refuses in CI/non-TTY unless `--accept-unsafe` is also passed.
- `--mode manual-only-explain` — emits the per-finding fix prose for rules where mechanical rewrite isn't safe (missing-signature-verification, wrong-hmac-algorithm, etc. — 35 rules ship as manual-only in v0.5).

**Safety contract:**

- **Atomic staging** — every rewrite lands in `.hookwarden-fix-staging/<run-id>/` first; the original files are renamed into place only after a re-scan confirms zero new findings. On any failure, the staging dir persists for inspection.
- **Forbidden-range mask** — the fixer NEVER edits inside template literals (JS/TS), triple-quoted strings (Python), heredocs/nowdocs/encapsed strings (PHP), or comments. Mask runs before every edit.
- **Conflict resolver** — when two findings target overlapping byte ranges, the fixer aborts the commit and prints an `--only <rule-id>` recipe so you can apply them one at a time.
- **Versioned JSON schema** — `--format json` emits a machine-readable diff against `https://hookwarden.dev/schemas/fix-output.v1.json` for IDE-plugin and CI tooling.

```bash
# Get the JSON diff for tooling
npx hookwarden fix ./your-app --format json
```

Use `hookwarden scan` for the read path, `hookwarden fix` for the write path — never `scan --fix` (rejected at parse time per the dry-run-as-default safety boundary).

---

## 📺 Real output

Output below is captured verbatim from `hookwarden v0.4.0` — each line is what
you'll see in your terminal, not a stylised mockup.

**Clean scan — exits 0:**

```
$ hookwarden scan ./your-app
No findings.
────────────
Found 0 critical · 0 high · 0 medium · 0 low · 0 info · 0 manual-review — 0 webhook handlers across 0 files
Scanned in 0.0 s · 1 / 1 candidates parsed (100.0% coverage) · engine v0.4.0 · rules v0.4.0
```

**Scan with the canonical Express middleware-ordering bug — exits 1:**

```
$ hookwarden scan ./your-app
× critical  server.js:10:1  stripe/express-middleware-ordering  not-verified
  Express webhook handler for Stripe has `express.json()` (or `body-parser.json()`) registered before the
  webhook route. JSON middleware consumes the request body; by the time the Stripe handler runs, the raw bytes
  used for HMAC are gone and `stripe.webhooks.constructEvent` cannot reproduce the signature.
  fix › register `express.json()` AFTER the webhook route, OR mount `express.raw({ type: 'application/json' })`
        only on the webhook path.
  docs › https://stripe.com/docs/webhooks/signatures

× critical  server.js:10:1  stripe/missing-signature-verification  not-verified
  Stripe webhook handler does not appear to verify the signature header before processing the event. Neither
  `stripe.webhooks.constructEvent` (Node SDK) nor `stripe.Webhook.construct_event` (Python SDK) is reachable
  from this handler within 3 hops, and no manual HMAC path was detected either. Stripe docs: "You should
  always verify events by checking the signature".
  fix › pass the raw request body, the `Stripe-Signature` header, and your `STRIPE_WEBHOOK_SECRET` to
        `stripe.webhooks.constructEvent` (Node) or `stripe.Webhook.construct_event` (Python) at the very top
        of the handler.
  docs › https://stripe.com/docs/webhooks

× critical  server.js:10:1  stripe/raw-body-misuse  not-verified
  Stripe webhook handler reads the signature header (or calls the SDK verify) but does not appear to receive
  the request body as raw bytes. Stripe's HMAC is computed over the raw payload — once `express.json()` (or
  any other JSON middleware) parses the body, the bytes used for the HMAC differ from what was sent and
  verification fails on every webhook.
  docs › https://stripe.com/docs/webhooks/signatures

────────────
Found 3 critical · 0 high · 0 medium · 0 low · 0 info · 0 manual-review — 1 webhook handler across 1 file
Scanned in 0.0 s · 1 / 1 candidates parsed (100.0% coverage) · engine v0.4.0 · rules v0.4.0
```

Notice: one Express middleware bug produces **three** findings — middleware-ordering, missing-signature-verification, and raw-body-misuse — because that single mistake violates three distinct invariants. Fixing one (re-ordering the middleware) clears all three at once. The rule-pack isn't double-counting; it's giving you three lenses on the same root cause so any one of them can be the entry point in code review.

**PHP scan (v0.4 third-language support) — `strcmp()` instead of `hash_equals()`:**

```
$ hookwarden scan ./your-php-app
× critical  index.php:10:9  stripe/timing-unsafe-comparison  not-verified
  Stripe webhook handler computes an HMAC manually but does not call `crypto.timingSafeEqual` (Node) or
  `hmac.compare_digest` (Python) for signature comparison. Plain `==` / `===` against an HMAC buffer leaks
  timing information and is exploitable on a fast network.
  fix › replace `expected === provided` with `crypto.timingSafeEqual(Buffer.from(expected),
        Buffer.from(provided))` in Node, or `hmac.compare_digest(expected, provided)` in Python.
  docs › https://stripe.com/docs/webhooks/signatures

────────────
Found 1 critical · 0 high · 0 medium · 0 low · 0 info · 0 manual-review — 1 webhook handler across 1 file
Scanned in 0.0 s · 1 / 1 candidates parsed (100.0% coverage) · engine v0.4.0 · rules v0.4.0
```

PHP's `strcmp()` (and `===` / `==`) are not constant-time; the equivalent safe call is `hash_equals($expected, $sig)`. The fix prose currently quotes the Node/Python equivalents — PHP-specific copy lands in a follow-up.

**Output legend:**

| Glyph | Severity | SARIF level | Exit-code contribution |
|---|---|---|---|
| `×` | `critical` | `error` | counted toward `--fail-on` threshold |
| `×` | `high` | `error` | counted toward `--fail-on` threshold |
| `!` | `medium` | `warning` | counted toward `--fail-on` threshold |
| `·` | `low` | `note` | counted toward `--fail-on` threshold |
| `·` | `info` | `note` | informational (e.g. `library-verified`) — does not fail CI |

The `state` column (right of the rule id) is the architectural three-state verdict: `not-verified`, `verified`, or `manual-review`. The footer surfaces total counts plus parse-coverage so you can spot a `--min-parse-coverage` regression at a glance.

**JSON envelope shape:**

```json
{
  "schema_version": "1.0",
  "engine": { "version": "0.4.0", "commit_sha": null },
  "rule_pack": { "version": "0.4.0", "content_hash": "51c219..." },
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

## 🌐 Languages & frameworks

3 languages, 11 frameworks, 1 codebase walker. PHP and Python use `tree-sitter`; JS/TS use Babel. Single-file vanilla-PHP handlers are detected heuristically; everything else routes through framework-specific adapters.

| Language | Frameworks | Parser |
|---|---|---|
| **JavaScript / TypeScript** | Express · Hono · Fastify · Next.js | `@babel/parser` |
| **Python** | Flask · FastAPI · Django | `tree-sitter-python` (WASM) |
| **PHP** (v0.4) | Laravel · Symfony · Slim · vanilla-PHP single-file | `tree-sitter-php` (WASM) |

PHP 8.0+ syntax floor. Python 3.10+ recommended. TypeScript: strict + non-strict both supported.

---

## 🔐 Provider coverage

45 rules across 6 providers, each applicable across the relevant subset of the 11 frameworks above. Every rule carries fix guidance quoted verbatim from the provider's canonical security documentation.

<p align="center">
  <a href="https://github.com/Hookwarden/hookwarden/tree/main/packages/rules/rules/stripe"><img src="https://img.shields.io/badge/Stripe-6366F1?style=for-the-badge&logo=stripe&logoColor=white" alt="Stripe" /></a>
  <a href="https://github.com/Hookwarden/hookwarden/tree/main/packages/rules/rules/github"><img src="https://img.shields.io/badge/GitHub-6366F1?style=for-the-badge&logo=github&logoColor=white" alt="GitHub" /></a>
  <a href="https://github.com/Hookwarden/hookwarden/tree/main/packages/rules/rules/shopify"><img src="https://img.shields.io/badge/Shopify-6366F1?style=for-the-badge&logo=shopify&logoColor=white" alt="Shopify" /></a>
  <a href="https://github.com/Hookwarden/hookwarden/tree/main/packages/rules/rules/slack"><img src="https://img.shields.io/badge/Slack-6366F1?style=for-the-badge&logo=slack&logoColor=white" alt="Slack" /></a>
  <a href="https://github.com/Hookwarden/hookwarden/tree/main/packages/rules/rules/twilio"><img src="https://img.shields.io/badge/Twilio-6366F1?style=for-the-badge&logo=twilio&logoColor=white" alt="Twilio" /></a>
  <a href="https://github.com/Hookwarden/hookwarden/tree/main/packages/rules/rules/square"><img src="https://img.shields.io/badge/Square-6366F1?style=for-the-badge&logo=square&logoColor=white" alt="Square" /></a>
</p>

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

## 🤖 CI integration

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

## 🏗 Architecture

hookwarden is a pnpm monorepo with three load-bearing packages and a strict dependency boundary enforced in CI.

```
Your repo source
       │
       ▼
   Walker  (file allowlist + test-path filter)
       │
       ▼
 @hookwarden/engine  ◀──  @hookwarden/rules
 (pure-functional,        (YAML rule packs +
  no I/O)                  parameterized predicates)
       │
       ▼
 Three-state verdict
   ├─ reachable + safe    → verified
   ├─ reachable + unsafe  → not-verified
   └─ unprovable          → manual-review
       │
       ▼
   CLI renderer  →  text · JSON · SARIF 2.1.0
```

The verdict-state machine is the architectural contract — every finding lives in exactly one of these states, and the false-positive rate stays honest by routing analysis-defeated cases to `manual-review` rather than guessing:

```
[discovered]
     │  (handler reached by walker)
     ▼
[reachability check]  ──── signature-verify reachable ≤ 3 hops ──→  verified       (exit 0)
     │
     ├─ no verify call reachable                                ──→  not-verified   (exit 1)
     │
     └─ analyzer defeated (dynamic dispatch, middleware unroll,
        parse error)                                            ──→  manual-review  (exit 0, non-blocking)
```

| Package | Purpose | License |
|---|---|---|
| [`@hookwarden/engine`](https://github.com/Hookwarden/hookwarden/tree/main/packages/engine) | Webhook handler discovery, reachability analysis, evidence collection. Pure-functional, browser-safe — no I/O, no filesystem, no network. | Apache 2.0 |
| [`@hookwarden/rules`](https://github.com/Hookwarden/hookwarden/tree/main/packages/rules) | Provider catalog, YAML rule packs, parameterized predicate factories. | Apache 2.0 |
| [`hookwarden`](https://github.com/Hookwarden/hookwarden/tree/main/packages/cli) | CLI binary. Reads config, drives the engine, renders text/JSON/SARIF. | Apache 2.0 |

The engine's I/O boundary is the architectural load-bearing constraint. The same engine runs in the CLI, in CI, and — eventually — in a browser playground without modification. `dependency-cruiser` enforces the boundary in every PR.

---

## 🆚 vs. other tools

Hookwarden is **specialized on purpose.** Webhook signature verification is the only thing it does, and that's why it does it better than tools whose surface area covers everything. The general-purpose scanners below are excellent at what they do — they're just not in this fight.

| Tool | What it does well | Webhook verification coverage |
|---|---|---|
| **semgrep** | General-purpose SAST; flexible rule authoring | Low signal — generic pattern matching misses body-parsing ordering, timing-safe comparison paths, and SDK-specific verification flows |
| **snyk Code** | Broad vulnerability detection in paid SaaS | No webhook-specific rules; doesn't model HMAC reachability |
| **GitGuardian** | Secret leak detection in git history and CI | Finds hardcoded secrets; does not audit whether verification logic is correct |
| **TruffleHog** | Secret scanning across sources | Same as GitGuardian — leak focus, not logic focus |
| **Datadog Static Analysis** | Broad SAST; good AWS/cloud signal | No webhook verification specialization; generic SAST rules produce low-signal findings for this class of bug |
| **hookwarden** | Webhook verification logic only | 45 rules, 6 providers, three-state verdicts, <5% FP rate measured against a 200-repo OSS corpus |

If you're already running semgrep or snyk: hookwarden is additive, not a replacement. It finds the class of bug those tools were not built to find.

---

## 🛠 Advanced usage

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

## 🗺 Roadmap

**Recently shipped (v0.3)**
pre-commit hook · Homebrew tap · Scoop/WinGet manifests · standalone binaries (Linux x64/arm64, Windows x64). macOS users install via `npx hookwarden` or `npm i -g hookwarden`.

**Recently shipped (v0.4) — PHP language support + `--provider` filter.** Laravel, Symfony, Slim, and vanilla-PHP single-file handlers via `tree-sitter-php` WASM. PHP variants of every applicable rule across the six v1 providers (`hash_equals` as the safe-compare predicate, `php://input` / `->getContent()` / `$_POST` as recognised raw-body shapes, `\Stripe\Webhook::constructEvent` and equivalent FQNs in the SDK-reach catalog). New `--provider stripe,github` flag for phased rollout — security teams adopt one provider at a time without flooding PRs.

**v0.4.1 — monorepo scoping.** `--exclude GLOB` / `--include GLOB` CLI flags so monorepos can skip `apps/legacy/**`, vendor trees, etc. from the command line (today only the YAML config supports this).

**v0.4.2 — `hookwarden explain <rule-id>`.** Terminal-side rule documentation: rationale, catalog entry, positive/negative fixture excerpts. Lowers the support burden on the rule-pack maintainer; deepens developer trust without leaving the terminal.

**✅ v0.5 — `hookwarden fix` auto-remediation.** The mechanical fixes (`===` → `crypto.timingSafeEqual`, `==` → `hash_equals`, etc.) applied with a real AST-rewrite engine. Safe / unsafe / manual-only classification per rule. Three-state verdicts already classified which fixes are safe to auto-apply — `hookwarden fix` makes that machine-actionable. **[See Auto-fix above](#-auto-fix-v05).**

**v0.6 — More providers.** Adyen, Zendesk, Mailgun — each measured against the 200-repo OSS regression corpus before release, with a published false-positive rate.

**v0.7 — Corpus integrity.** `verify-changeset-delta` — every PR's rule changes run against the full corpus and the `findings_delta` block must match the actual delta before merge.

---

## 🤝 Contributing

Rule-pack PRs are the highest-value contribution. Adding a new provider is a catalog edit plus N rule YAMLs — the factory architecture means most providers ship without any new TypeScript. See the existing six providers in [`packages/rules/rules/`](https://github.com/Hookwarden/hookwarden/tree/main/packages/rules/rules) as worked examples.

Bug reports and feature requests: [open an issue](https://github.com/Hookwarden/hookwarden/issues).

Local development:

```bash
pnpm install
pnpm -r build
pnpm -r test
```

More: [hookwarden.dev](https://hookwarden.dev) · [rule coverage matrix](https://github.com/Hookwarden/hookwarden/blob/main/docs/rule-coverage.md) · [GitHub Action docs](https://github.com/Hookwarden/hookwarden/tree/main/packages/github-action).

---

## 📄 License

Apache 2.0 — see [`LICENSE`](https://github.com/Hookwarden/hookwarden/blob/main/LICENSE). The CLI, engine, and rule packs in this repo are open source and will remain so. A separate closed-source SaaS tier handles continuous monitoring, secret leak scanning, automated rotation, and SOC 2 evidence export — [hookwarden.dev](https://hookwarden.dev).

Brand assets live at [`assets/brand/`](https://github.com/Hookwarden/hookwarden/tree/main/assets/brand).
