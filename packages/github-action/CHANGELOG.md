# @hookwarden/github-action

## 0.5.3

### Patch Changes

- Updated dependencies
- Updated dependencies [a2e1946]
  - hookwarden@0.5.3

## 0.5.2

### Patch Changes

- Updated dependencies [4a2201b]
- Updated dependencies [992b3d2]
  - hookwarden@0.5.2

## 0.5.1

### Patch Changes

- 525ad50: Emergency patch — v0.5.1.

  v0.5.0 shipped `hookwarden` declaring a dependency on `@hookwarden/fix@0.0.1`
  but the `@hookwarden/fix` package was never published to npm. Every fresh
  `npx hookwarden scan .` since v0.5.0 has failed with HTTP 404 on
  `https://registry.npmjs.org/@hookwarden%2ffix`.

  Root cause: `@hookwarden/fix` was not in the changesets `fixed` group, so
  when v0.5.0's changeset bumped the CLI + engine + rules together, it
  silently skipped publishing `@hookwarden/fix`. The package was correctly
  configured for publish (`publishConfig: { access: 'public' }`, not
  `private`, built into `dist/`) — the publish pipeline just never targeted
  it.

  This patch:

  - Adds `@hookwarden/fix` to the `fixed` group in `.changeset/config.json`,
    so future bumps keep it in lockstep with the other publishable workspace
    packages. Prevents recurrence.
  - Bumps every package in the fixed group to v0.5.1 so the CLI's pinned
    `@hookwarden/fix` dep resolves against a version that's actually on the
    registry.

  No behavior changes vs. v0.5.0 — pure release-pipeline hygiene.

- Updated dependencies [525ad50]
  - hookwarden@0.5.1

## 0.5.0

### Patch Changes

- Updated dependencies [66814fc]
  - hookwarden@0.5.0

## 0.4.0

### Minor Changes

- 13b7438: feat(php): PHP language support — v1 third language alongside JS/TS and Python

  hookwarden now scans PHP webhook handlers and produces the same 3-state findings
  (verified / not-verified / manual-review) as JavaScript/TypeScript and Python.

  **Frameworks**: Laravel, Symfony, Slim, and vanilla-PHP single-file handlers.
  Laravel and Slim ship as declarative-routing detection in the engine catalog;
  Symfony attributes (`#[Route]`) ship via a bespoke adapter; vanilla-PHP ships
  as a heuristic adapter (positive signals: `file_get_contents('php://input')`,
  `hash_hmac()`, `$_SERVER['HTTP_*_SIGNATURE']` reads, `getallheaders()`).

  **Providers**: All six v1 providers — Stripe, GitHub, Shopify, Slack, Twilio, Square.
  Catalog gains PHP namespace prefixes (`Stripe\`, `Shopify\`, `Twilio\`, `Square\`)
  and PHP FQN call shapes (`Stripe\Webhook::constructEvent`,
  `Shopify\Utils::validateHmac`, `Twilio\Security\RequestValidator::validate`,
  `Square\Utils\WebhooksHelper::isValidWebhookEventSignature`). GitHub and Slack
  intentionally ship no PHP namespace prefix — both providers' PHP webhook
  verification is overwhelmingly hand-rolled `hash_hmac` + `hash_equals`; the
  language-agnostic rules catch the manual-flow shape.

  **Rule pack PHP additions**: `_helpers-php.ts` shared AST walkers + per-provider
  PHP predicates (`stripe-php-timing-unsafe-comparison`, `github-php-timing-safe-equal`)

  - generic predicate PHP dispatch (`timing-unsafe-comparison`, `missing-signature-verification`,
    `github-timing-safe-equal`, `library-verified-recognition`). 43 v1-provider YAMLs
    get `applies_to` extended with `laravel`, `symfony`, `slim`, `vanilla-php`.
    Express-only rules (`stripe/express-middleware-ordering`,
    `github/missing-timing-safe-equal`) intentionally preserved JS-only.

  **WASM artefact**: `tree-sitter-php.wasm` (`tree-sitter-php@0.24.2`) embedded in
  the compiled binaries via the dual-path WASM loader from Phase 4.2 DC-13.

  **Engine purity preserved (D-01)**: PHP loader lives in the CLI; the engine's
  `parsePhp` receives wasm bytes from the CLI runner and never touches the
  filesystem. The 50K-LOC perf integration test scans the combined JS+Python+PHP
  corpus (~88K LOC total) in 2.4s on developer hardware — substantial headroom
  under the 30s ENGINE-06 gate.

  **Quality bar**: FP-01 measurement against the curated PHP corpus is 0% (0/11
  negative fixtures) at high/critical severity excluding manual-review findings.

  PHP 8.0+ syntax floor. See the [language coverage matrix](docs/rule-coverage.md)
  for the per-rule per-framework breakdown.

- feat: CLI surface expansion + engine OOTB-noise reduction

  Three new CLI flags, one new subcommand, and two engine improvements informed by real-world OSS corpus smoke against 11 production repos containing webhook handlers (Stripe, GitHub, Slack, Shopify, Twilio, Square).

  **New CLI surface:**

  - **`hookwarden explain <rule-id>`** — terminal-side rule documentation lookup. Same renderer that powers in-scan finding messages; useful for offline rule research without re-running a full scan.
  - **`--exclude` / `--include` GLOB flags** — monorepo scoping. `--include` narrows first, `--exclude` removes after. Composes with both `hookwarden scan` and `hookwarden inventory`.
  - **`--provider <stripe|github|shopify|slack|twilio|square>`** — phased-rollout filter for staged adoption. Comma-separated for multiple providers (`--provider stripe,github`); gate CI on one provider at a time as you adopt.
  - **`--include-tests`** flag (+ `scan_tests: true` config + `HOOKWARDEN_SCAN_TESTS=1` env) — opt back in to scanning test/fixture paths after the default-exclusion change below.

  **Engine improvements (corpus-driven):**

  - **`pages/_app.js` / `pages/_document.js` (Next.js JSX-in-`.js`) now parse cleanly.** The Babel `jsx` plugin is enabled for `.js`, `.mjs`, and `.cjs` in addition to the previously-supported `.jsx` and `.tsx`. Plain `.ts` files still parse without `jsx` (preserving angle-bracket type assertions like `<number>(value)` — TypeScript itself requires the explicit `.tsx` extension to enable JSX). Eliminates 2 manual-review parse-errors on `kinngh/shopify-nextjs-prisma-app`.
  - **Test/fixture paths are excluded by default.** Production webhook routes almost never live under `test/`, `tests/`, `__tests__/`, `spec/`, `fixtures/`, `mocks/`, `*.test.{ts,tsx,js,jsx,mjs,cjs}`, `*.spec.{ts,tsx,js,jsx,mjs,cjs}`, `test_*.py`, or `*_test.py`. Their handlers are typically deliberately-broken fixtures that exercise the test harness and would otherwise dominate the findings list. The text-output footer surfaces a `(N test/fixture files auto-excluded; use --include-tests to scan)` hint so users always know what was skipped. Eliminates the `probot/probot` false-positive class (4 critical findings, all in `test/integration/*.test.ts` fixtures).

  **Bug fix:**

  - `runScan`'s `buildProjectModel` call now receives the full `ALL_ADAPTERS` registry; previously a subset was passed, suppressing detection in edge cases.

  Composes with the PHP language-support changeset to ship as v0.4.0.

### Patch Changes

- Updated dependencies [13b7438]
- Updated dependencies
  - hookwarden@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [2496be2]
  - hookwarden@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies [f72331f]
- Updated dependencies [08fb590]
- Updated dependencies [442f0b9]
  - hookwarden@0.3.0

## 0.2.0

### Patch Changes

- hookwarden@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [0a0ff4c]
- Updated dependencies [1fadc62]
  - hookwarden@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies [89746ba]
- Updated dependencies [43379cb]
- Updated dependencies [c7b39d1]
  - hookwarden@0.1.0

## 0.0.1

### Patch Changes

- 7ffb431: Initial v0.0.1 release — defensive name registrations.

  Empty stubs for all 9 OSS package names (1 canonical + 4 scoped + 5 typo
  shims) to claim namespaces on npm before any public mention. Functional
  implementations land in subsequent versions.

- Updated dependencies [7ffb431]
  - hookwarden@0.0.1
