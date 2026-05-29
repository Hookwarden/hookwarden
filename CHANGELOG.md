# hookwarden

Project-level release notes. Per-package Changesets entries (engine, rules,
cli, github-action) live in each package's own `CHANGELOG.md`.

## 0.6.0

### 15 new provider rule packs — effective coverage 9 → ~31

`hookwarden scan` now ships rule packs for fifteen additional providers
across four waves of Phase 8.3. Each pack is a catalog entry + five-or-more
catalog-parameterized rules + provider-specific tests across JS/TS, Python,
and PHP. Six of the packs include a dedicated provider-specific
bug-pattern rule on top of the baseline six — the kind of catch the
catalog-parameterized factories can't express on their own.

| Wave | Providers | Notable provider-specific rules |
|---|---|---|
| 1 | Zendesk, DocuSign, Intercom, Linear | Intercom `octokit-cross-attribution` (later retrofit — flags `@octokit/webhooks` usage on Intercom's shared `X-Hub-Signature` header) |
| 2 | HubSpot, Auth0, Mailchimp, Postmark | HubSpot D-92 custom-signing slot (canonical `${method}${uri}${body}${ts}`), Mailchimp `url-secret-in-path` rule kind, Postmark Basic Auth + IP allowlist auth model |
| 3 | Datadog, Sentry, PagerDuty, Bitbucket | PagerDuty `multi-signature-rotation-mishandled` (catches handlers that don't iterate `v1=<hex>,v1=<hex>` rotation tokens), Bitbucket `signature-prefix-not-stripped` (catches handlers that compare `sha256=<hex>` against bare HMAC), Sentry `header-confusion` (Sentry-Hook-Resource vs Sentry-Hook-Signature) |
| 4 | Notion, Calendly, Zoom | Notion D-92 sixth-occupant custom slot + `verification-token-only` rule, Calendly `signature-header-parse-mishandled` (comma-separated `t=<unix>,v1=<hex>` parse), Zoom `url-validation-only` rule |

Three providers share `X-Hub-Signature` literally (github + intercom +
bitbucket) — the test suite includes dedicated three-way cross-provider
attribution tests so adding bitbucket doesn't false-positive on github
handlers or vice versa.

Effective provider coverage takes a second jump from Standard Webhooks
spec detection (shipped in v0.5.x via the catalog) which sweeps in
conformant providers (Clerk, Resend, Lob, Mux, Knock, Brex, ChannelTalk,
Liveblocks, Sumsub) without per-provider rule packs.

### Stripe empty-secret bypass — CVE-2026-41432 detector

A new dedicated predicate at `packages/rules/src/predicates/stripe-empty-secret.ts`
catches the CVE-2026-41432 attack class on JS/TS sources: HMAC-SHA256 over
an empty signing key matches a forged signature an attacker computes with
the same empty key, so passing an empty-string secret to
`stripe.webhooks.constructEvent` silently succeeds.

The Babel AST walker inspects the third positional argument at every
`constructEvent` call site and classifies it independently into four
shipped D-05 variants:

  - `secret || ''`                (logical-OR fallback)
  - `secret ?? ''`                (nullish-coalescing fallback)
  - `secret ? secret : ''`        (ternary fallback)
  - `constructEvent(b, s, '')`    (explicit empty-string literal — the literal CVE-2026-41432 repro shape)

Two further variants (missing nullish guard, optional chaining) plus
Python and PHP language coverage are deferred to a follow-up release
under the Plan 17b backlog documented in this phase's SUMMARY artifacts.
Critical severity, fires on every distinct call site in a handler file.

### CVE corpus — auditor-facing correctness moat

Five before/after fixture pairs ship under `e2e/fixtures/cve/`, each
reproducing a real-world webhook-verification CVE in `vulnerable/` and
the recommended remediation in `fixed/`:

  - **Clerk CVE-2025-53548** (GHSA-c6q9-xc7g-72v6) → `standardwebhooks/timing-unsafe-comparison`
  - **n8n GHSA-jf52-3f2h-h9j5** → `stripe/missing-signature-verification`
  - **CVE-2026-41432** (Stripe empty-secret) → `stripe/empty-secret-bypass` (new this release)
  - **CVE-2026-44109** (raw-body misuse) → `stripe/raw-body-misuse`
  - **CVE-2026-4984** (Twilio missing signature) → `twilio/missing-signature-verification`

Every fixture file carries a three-line load-bearing header tag
(`hookwarden:cve` / `hookwarden:rule` / `hookwarden:state`) that
`e2e/cve-corpus.test.ts` parses to enforce a CI-blocking drift guard:
every CVE in the public corpus MUST map to a predicate that is registered
in the rule pack's `ALL_PREDICATES` table. The corpus cannot claim
detection coverage for a rule the rule pack doesn't ship.

The Astro Starlight `/cves/` route (per-CVE detail pages + index) is
deferred to a follow-up plan in line with the public web presence's
own ship schedule.

### Test count: 517 → 700

The rule pack gains 183 new predicate-level tests across the Wave 3 + Wave 4
work. Every provider-specific bug-pattern rule carries its own independence
assertions so a regression that collapses two distinct match arms surfaces
as the wrong-tag failure mode rather than silently widening the rule's
verdict surface. The three-way X-Hub-Signature disambiguation suite is the
load-bearing cross-provider attribution evidence.

### Windows Authenticode signing status

v0.6.0 Windows .exe ships unsigned if Microsoft Trusted Signing validation
for the BITLY SRL identity is still pending at release time (first-run
SmartScreen warning). The signing certificate will be applied on the next
patch release once validation completes.

## 0.5.0

### macOS now installs via Homebrew

`brew install Hookwarden/tap/hookwarden` works on macOS for the first time
in the project's history. The Linux formula continues to pull the bun-compiled
standalone binary; the macOS formula installs the published npm tarball under
`libexec` and symlinks the `hookwarden` command — same engine, same rules, same
outputs. macOS adds `node` as a runtime dep (brew handles transparently); no
darwin bun-compiled binary ships, since Apple Developer Program enrollment for
notarisation is still unfunded.

**Brew bump pipeline updated for the new shape:**

- `scripts/release/bump-homebrew.sh` now downloads the published npm tarball
  alongside `checksums.txt` and computes its sha256 before invoking the edit
  core. The 3 sha256 lines (npm + linux-arm64 + linux-x64) are pinned in source
  order; both the GH `releases/download/` URLs and the npm `hookwarden-X.Y.Z.tgz`
  URL get version-bumped in one pass.
- `scripts/release/verify-channel-parity-core.sh` extracts only sha256 lines
  paired with a `releases/download/` URL — the top-level npm-tarball SHA is
  intentionally non-canonical (its integrity is verified through the npm
  registry's own publish chain + the bump script's own download-and-pin step).

### Release-tooling test depth

The release pipeline now ships ~180 named test cases across three layers, up
from ~14 in v0.4.x. Each forbidden symbol, forbidden runtime dep, dep-cruiser
rule, and parity-gate divergence pattern has its own named test row — a CI
failure pinpoints exactly which invariant broke instead of "violations: [...]".

| Layer | v0.4.x | v0.5.0 | Coverage |
|---|---|---|---|
| `bump-homebrew-edit` | 7 | 20 | + pre-release tags (v1.0.0-rc.1), sequential bumps, missing-input errors, DOS line endings, comment-injected sha256 evasion, malformed-VERSION rejection |
| `verify-channel-parity` | 6 | 15 | + reordered SHAs, on_macos-regrowth attacker scenarios, malformed JSON inputs, multi-channel divergence pinpointing, off-by-one truncated SHAs |
| `docker-smoke-binaries` | 7 × 6 distros | 10 × 6 distros = 60 | + Laravel-shaped PHP fixture (namespace use + Route closure + `===`), `inventory` subcommand, `explain` subcommand |
| **Engine purity gates** | 10 | **85** | per-symbol forbidden-import tests (16), per-dep package.json gate (15), regex-narrowness anti-false-positive cases (12), per-dep-cruiser-rule fixture tests (10), config-presence + severity assertions (5), carve-out verification at package.json layer (6), dynamic-require evasion guard (3) |

The 85 purity cases are the auditor-facing evidence that D-01 (engine purity)
and D-05 (AST mutation bounded to `packages/fix/`) hold. The dist-grep gate
now also catches `require.resolve("@babel/traverse")` string-based escape
hatches, not just static imports.

### Auto-remediation engine — `hookwarden fix`

hookwarden goes from "tells you the fix" to "applies it on the safe subset".
The new `hookwarden fix` subcommand mechanically rewrites `safety: safe`
findings across JS/TS, Python, and PHP.

**Three safety modes (D-12 + D-13):**

- `--mode safe` (default) — applies the 10 rules in the v0.5 safe set
  (timing-unsafe-comparison + raw-body-misuse families, 4 fix families
  × 3 languages minus 2 documented omissions).
- `--mode all` — adds rules marked `unsafe`; refuses in non-TTY without
  `--accept-unsafe`.
- `--mode manual-only-explain` — emits per-finding fix prose for the 35
  rules where mechanical rewrite cannot guarantee D-11 safety.

**Safety contract (SC#6 + SC#5):**

- **Atomic staging at `.hookwarden-fix-staging/<run-id>/`.** Rewrites land
  in the staging dir first, then re-scan verifies zero new findings before
  the atomic rename into place. On any failure, the staging dir persists
  for inspection. First `--write` run auto-appends
  `.hookwarden-fix-staging/` to `.gitignore` with a loud stderr notice.
- **Forbidden-range mask** — the fixer NEVER touches template literals
  (JS/TS), triple-quoted strings (Python), heredocs/nowdocs/encapsed
  strings (PHP), or comments. Mask runs before every edit; rewriter
  rejects any edit that intersects.
- **Single-line constraint** — edits spanning multiple AST lines are
  rejected in v0.5; multi-line rewrites defer to v0.6+.
- **Sequential conflict resolver** — when two findings target overlapping
  ranges on the same file, the fixer aborts the commit and prints the
  exact `--only <rule-id>` recipe to apply them one at a time. No silent
  code loss.

**JSON schema v1.0 (D-22 + SC#7):**

`hookwarden fix --format json` emits a machine-readable diff against the
v1.0 schema at `https://hookwarden.dev/schemas/fix-output.v1.json`. Stable
contract — `--format json` forces dry-run.

**Per-rule `fix:` YAML metadata (D-01 + D-04 + SC#9):**

Every rule in the rule pack now declares either a populated `fix:` block
or `fix: null`. Schema rejects rules that omit the key.

**Deliberate scope reductions:**

- **Python raw-body-misuse is manual-only in v0.5.** Flask's `request.data`
  semantics depend on Content-Type + parser state — mechanical rewrite
  cannot guarantee semantic preservation.
- **PHP missing-nullish-guard is manual-only.** PHP's `??` / `isset()`
  idioms make a one-line text-range rewrite too invasive for v0.5.

**Engine purity gate preserved (D-05 + SC#12).** `@babel/traverse` and
`@babel/generator` are confined to `packages/fix/` only. Verified by
dependency-cruiser at the source layer AND a new dist-grep purity test
at the build layer.

**Test coverage:** 942 tests across 4 packages. Round-trip fixture corpus
exercises 5 positive + 4 negative cases across all 3 v1 languages with
byte-exact equality assertions.

**Bug fixes:**

- `hookwarden scan --fix` now rejected at parse time with the canonical
  `Use 'hookwarden fix [<path>]'` pointer per D-16.

## 0.4.0

### PHP language support — v1 third language

hookwarden now scans PHP webhook handlers and produces the same 3-state
findings (verified / not-verified / manual-review) as JavaScript/TypeScript
and Python.

**Frameworks**: Laravel, Symfony, Slim, and vanilla-PHP single-file
handlers. Laravel and Slim ship as declarative-routing detection in the
engine catalog; Symfony `#[Route]` attributes ship via a bespoke adapter;
vanilla-PHP ships as a heuristic adapter (positive signals:
`file_get_contents('php://input')`, `hash_hmac()`,
`$_SERVER['HTTP_*_SIGNATURE']` reads, `getallheaders()`).

**Providers**: All six v1 providers (Stripe, GitHub, Shopify, Slack,
Twilio, Square). Catalog gains PHP namespace prefixes and FQN call
shapes (`Stripe\Webhook::constructEvent`, `Shopify\Utils::validateHmac`,
`Twilio\Security\RequestValidator::validate`,
`Square\Utils\WebhooksHelper::isValidWebhookEventSignature`). 43
v1-provider YAMLs get `applies_to` extended with `laravel`, `symfony`,
`slim`, `vanilla-php`. Express-only rules
(`stripe/express-middleware-ordering`, `github/missing-timing-safe-equal`)
intentionally preserved JS-only.

**Quality bar**: FP-01 measurement against the curated PHP corpus is 0%
(0/11 negative fixtures) at high/critical severity excluding
manual-review findings. PHP 8.0+ syntax floor.

**Engine purity preserved**: the PHP loader lives in the CLI; the
engine's `parsePhp` receives WASM bytes from the CLI runner and never
touches the filesystem. The combined JS+Python+PHP perf corpus (~88K
LOC) scans in 2.4s on developer hardware — substantial headroom under
the 30s ENGINE-06 gate.

### CLI surface expansion

Three new flags and one new subcommand:

- **`hookwarden explain <rule-id>`** — terminal-side rule documentation
  lookup. Same renderer that powers in-scan finding messages; useful
  for offline rule research without re-running a full scan.
- **`--exclude` / `--include` GLOB flags** — monorepo scoping.
  `--include` narrows first, `--exclude` removes after. Composes with
  both `hookwarden scan` and `hookwarden inventory`.
- **`--provider <stripe|github|shopify|slack|twilio|square>`** —
  phased-rollout filter for staged adoption. Comma-separated for
  multiple (`--provider stripe,github`); gate CI on one provider at a
  time as you adopt.
- **`--include-tests`** flag (+ `scan_tests: true` config +
  `HOOKWARDEN_SCAN_TESTS=1` env) — opt back in to scanning test/fixture
  paths after the default-exclusion change below.

### Engine improvements (surfaced by real-world OSS corpus smoke)

Two behavior changes informed by running v0.3.1 against 11 production OSS
repos containing webhook handlers (Stripe, GitHub, Slack, Shopify, Twilio,
Square). Both eliminate OOTB noise that previously buried real findings.

- **`pages/_app.js` / `pages/_document.js` (Next.js JSX-in-.js) now parse
  cleanly.** The Babel `jsx` plugin is now enabled for `.js`, `.mjs`, and
  `.cjs` extensions in addition to the previously-supported `.jsx` and
  `.tsx`. Per Babel docs, the `jsx` plugin does not change parsing of
  non-JSX code. Plain `.ts` files still parse without `jsx` (preserving
  angle-bracket type assertions like `<number>(value)`, which would
  conflict with JSX opening-tag syntax — TypeScript itself requires
  the explicit `.tsx` extension to enable JSX).

- **Test/fixture paths are now excluded by default.** Production webhook
  routes almost never live under `test/`, `tests/`, `__tests__/`,
  `spec/`, `fixtures/`, `mocks/`, `*.test.{ts,tsx,js,jsx,mjs,cjs}`,
  `*.spec.{ts,tsx,js,jsx,mjs,cjs}`, `test_*.py`, or `*_test.py`. Their
  handlers are typically deliberately-broken fixtures that exercise the
  test harness and would otherwise dominate the findings list. Opt back
  in with the new `--include-tests` flag, the `scan_tests: true` config
  field, or the `HOOKWARDEN_SCAN_TESTS=1` env var. When auto-excluded
  files are present, the text-output footer surfaces a `(N test/fixture
  files auto-excluded; use --include-tests to scan)` hint so users
  always know what was skipped.

### Bug fix

- `runScan`'s `buildProjectModel` call now receives the full
  `ALL_ADAPTERS` registry; previously a subset was passed, suppressing
  detection in edge cases.

### Real-world corpus impact (11 popular OSS repos)

| Repo | Before | After |
|------|--------|-------|
| `probot/probot` | 4 findings (3 critical) — all in `test/integration/*.test.ts` fixtures | 0 findings; 57 test files auto-excluded |
| `kinngh/shopify-nextjs-prisma-app` | 2 manual-review parse-errors (`pages/_app.js`, `pages/_document.js`) | 0 findings; 49/49 candidates parsed |
| 9 other repos | already clean | still clean |

## 0.3.0

### Distribution channels

v0.3.0 introduces Linux (arm64, x64) and Windows (x64) standalone binaries
via `bun build --compile`, distributed through Homebrew (Linux only),
Scoop (Windows), WinGet (Windows), and the PyPI shim (Linux + Windows).
v0.2.0 was npm-only; v0.3.0 begins the channel fan-out for Linux + Windows
but **does not include macOS binaries** — Apple Developer Program
enrollment is not funded for this release. macOS users continue using
`npx hookwarden` (the npm path). The macOS binary surface is deferred to
a future funded release.

The same SHA-pinned artifact is available via:

- `npx hookwarden` — npm package (existing channel; only supported path
  on macOS for v0.3.0)
- `brew install hookwarden` — Homebrew tap, Linux only (NEW; macOS falls
  through to a `npx hookwarden` recommendation)
- `scoop install hookwarden` — Scoop bucket, Windows (NEW)
- `winget install hookwarden` — WinGet manifest, Windows (NEW)
- `pip install hookwarden` — PyPI binary-fetcher shim, Linux + Windows
  (NEW; on macOS the shim falls back to recommending `npx hookwarden`)

Channel parity is enforced by a release-pipeline gate: every channel pulls
the same `bun build --compile` artifact SHA from a single signed
`checksums.txt`. Windows binaries are Authenticode-signed via Azure Trusted
Signing.

v0.2.0 was npm-only by design — channel fan-out begins at v0.3.0 for
Linux + Windows. v0.2.0 is not backfilled to the package-manager channels;
users who need a non-npm install on Linux or Windows should upgrade to
v0.3.0 or later. macOS users on any version should keep using
`npx hookwarden` until Apple Developer enrollment lands.
