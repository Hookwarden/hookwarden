# hookwarden

Project-level release notes. Per-package Changesets entries (engine, rules,
cli, github-action) live in each package's own `CHANGELOG.md`.

## 0.5.0

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
