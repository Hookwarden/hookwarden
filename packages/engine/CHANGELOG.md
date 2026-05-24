# @hookwarden/engine

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

## 0.5.0

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

## 0.3.1

## 0.3.0

## 0.2.0

### Minor Changes

- b32262e: feat(engine, rules): catalog-parameterized predicate architecture (D-90, D-91, D-93)

  ProviderCatalogEntry gains 5 additive readonly fields per D-91:
  hmac_algorithm, signing_input_format, timestamp_header, signature_encoding,
  applicable_rules. Existing fields unchanged — additive-only, no breaking change
  for callers reading provider_catalog[provider].signature_header etc.

  12 duplicated Stripe + GitHub provider-bound predicates collapse onto 6 catalog-
  parameterized factory predicates: missing-signature-verification, timing-unsafe-
  comparison, raw-body-misuse, missing-timestamp-check, wrong-hmac-algorithm,
  unreachable-verification. Existing 14 registered predicate keys preserve byte-
  identical names; existing Stripe + GitHub vitest suites stay green (regression net).

  Custom-predicate slot scaffolded at packages/rules/src/predicates/custom/ —
  actual provider-specific custom predicates (Twilio URL+sorted-params canonical-
  string, etc.) land in subsequent provider plans via a CUSTOM_SIGNING_PREDICATES
  registry that the missing-signature-verification factory dispatches to when
  catalog.signing_input_format === 'custom'.

  RULES_PACK_VERSION now sourced from package.json at module load (no drift).
  Closes drift bug between packages/rules/src/index.ts ("0.0.1") and
  packages/rules/package.json ("0.1.1").

  findings_delta:
  added: 0
  removed: 0
  severity_changes: []
  rationale: 'Refactor-only change. No new rule YAMLs ship; the 14 registered predicate keys preserve byte-identical names and behavior on existing Stripe + GitHub fixtures. The findings_delta:0 claim is verifiable by running the predicate vitest suite (107 → 135 passing tests; 28 new direct factory tests added, zero existing assertions modified) plus the e2e CLI integration suite (354 passing on the canonical happy + bug fixtures).'

- 961b967: feat(rules): Shopify rule pack (RULES-01)

  Catalog gains `shopify` entry with hmac_algorithm: 'sha256', signing_input_format: 'raw_body',
  signature_header: ['x-shopify-hmac-sha256'], signature_encoding: 'base64', timestamp_header: null.
  No new TS predicate code — pure additive use of the 06.1 catalog-parameterized factories.

  7 rule YAMLs ship for Shopify: missing-signature-verification, timing-unsafe-comparison,
  raw-body-misuse, missing-timestamp-check (info), wrong-hmac-algorithm, unreachable-
  verification, library-verified. hardcoded-secret-prefix is intentionally excluded per D-95
  (Shopify webhook secrets have no canonical prefix; `secret_literal_prefix: []` in catalog).
  11 synthetic JS fixtures + 3 Python fixtures cover all detection patterns + positive/negative
  cases per D-97.

  Bootstraps `docs/rule-coverage.md` with the per-provider applicability matrix (stripe + github

  - shopify rows; subsequent provider plans append rows).

  ALL_PREDICATES grows from 14 → 21 keys (7 new shopify-\* entries).

  findings_delta:
  added: 7
  removed: 0
  severity_changes: []
  rationale: 'New shopify/\* rules. Corpus repos containing Shopify webhook handlers will newly emit findings for missing-sig-verif, timing-unsafe, raw-body, wrong-hmac, and unreachable-verif. The 7-rule additive count matches applicable_rules length in PROVIDER_CATALOG.shopify. Verifiable via predicate vitest suite (test/shopify.test.ts) on synthetic fixtures.'

- 0bf95c1: feat(engine, rules): Twilio rule pack (RULES-01) + custom-predicate slot first use (D-92)

  Catalog gains `twilio` entry with hmac_algorithm: 'sha1', signing_input_format: 'custom',
  signature_encoding: 'base64', timestamp_header: null. The 'sha1' value extends the engine's
  hmac_algorithm union from `'sha256' | 'sha512'` to `'sha1' | 'sha256' | 'sha512'` — Twilio
  is the v1 outlier and the only sha1 provider. The union remains intentionally narrow (no
  md5, no sha224/sha384) so wrong-hmac-algorithm.ts derives WRONG_HINTS from a closed set.

  First real use of the D-92 custom-predicate slot:
  `packages/rules/src/predicates/custom/twilio-signing.ts` implements the entry-point
  verification check. The catalog entry sets `signing_input_format: 'custom'` and the
  missing-signature-verification factory dispatches via `CUSTOM_SIGNING_PREDICATES['twilio']`.
  Side-effect registration via static top-level import (no dynamic import; engine purity
  preserved per D-23). The factory's wrong-hmac-algorithm.ts already handles 'sha1' via its
  `ALL_ALGO_HINTS.filter` derivation — no additional branching code needed.

  7 rule YAMLs ship for Twilio: missing-signature-verification, timing-unsafe-comparison,
  raw-body-misuse, missing-timestamp-check (info), wrong-hmac-algorithm (high; sha1 expected),
  unreachable-verification, library-verified. hardcoded-secret-prefix excluded per D-95.

  ALL_PREDICATES grows from 21 → 28 keys (7 new twilio-\* entries).
  docs/rule-coverage.md gains the twilio row noting the custom-predicate path.

  findings_delta:
  added: 7
  removed: 0
  severity_changes: []
  rationale: 'New twilio/\* rules + sha1 hmac_algorithm union extension. Corpus repos containing twilio webhook handlers will newly emit findings for missing-sig-verif, timing-unsafe, raw-body, wrong-hmac, and unreachable-verif. The sha1 union extension is a discrete, reviewed type change — downstream callers that exhaustively switch on hmac_algorithm will surface a compile-time error (desired failure mode).'

- f28136e: feat(rules): Slack rule pack — first non-null timestamp_header (RULES-01)

  Catalog gains `slack` entry with hmac_algorithm: 'sha256', signing_input_format:
  'timestamp_dot_body', signature_header: ['x-slack-signature'], signature_encoding: 'hex',
  timestamp_header: 'x-slack-request-timestamp'. Slack is the FIRST provider in the v1 catalog
  where timestamp_header is non-null — the parameterized missing-timestamp-check factory's
  non-null branch is exercised end-to-end (5-minute tolerance window per Slack docs;
  slack/missing-timestamp-check ships at severity: high, NOT info).

  Slack's canonical-string `'v0:' + ts + ':' + body` IS representable by the parameterized
  `timestamp_dot_body` recipe — no custom predicate needed. Pure additive use of 06.1's locked
  factories.

  7 rule YAMLs ship: missing-signature-verification, timing-unsafe-comparison, raw-body-misuse,
  missing-timestamp-check (high), wrong-hmac-algorithm, unreachable-verification, library-
  verified. hardcoded-secret-prefix excluded per D-95 (Slack signing secrets have no canonical
  prefix; xoxb-/xoxp- API tokens are different and live in Phase 11 leak-scanner scope).

  ALL_PREDICATES grows from 28 → 35 keys (7 new slack-\* entries).
  docs/rule-coverage.md gains the slack row.

  11 JS + 3 Python synthetic fixtures under test/fixtures/slack/. test/slack.test.ts adds
  ~17 it() assertions including explicit Date.now-reachable / not-reachable cases for the
  non-null timestamp_header branch.

  findings_delta:
  added: 7
  removed: 0
  severity_changes: []
  rationale: 'New slack/\* rules. Corpus repos containing Slack webhook handlers will newly emit findings for missing-sig-verif, timing-unsafe, raw-body, wrong-hmac, unreachable-verif, AND missing-timestamp-check (the latter at severity: high — Slack signing requires the 5-minute tolerance per their docs). The 7-rule additive count matches applicable_rules length in PROVIDER_CATALOG.slack.'

- 5c5811f: feat(rules): Square rule pack — first custom_field_tuple recipe (RULES-01)

  Catalog gains `square` entry with hmac_algorithm: 'sha256', signing_input_format:
  'custom_field_tuple' (URL+body), signature_header: ['x-square-hmacsha256-signature'],
  signature_encoding: 'base64', timestamp_header: null. After 06.5, four of five
  signing_input_format recipes are exercised end-to-end (raw_body, timestamp_dot_body,
  custom, custom_field_tuple); only url_plus_sorted_params remains documentation-only.

  6 rule YAMLs ship for Square: missing-signature-verification, timing-unsafe-comparison,
  raw-body-misuse, wrong-hmac-algorithm, unreachable-verification, library-verified.

  - missing-timestamp-check intentionally NOT shipped (Square's signing scheme has no
    timestamp header; replay protection is the application's responsibility — analogous
    to Twilio).
  - hardcoded-secret-prefix intentionally NOT shipped per D-95 verification: Square's
    webhook subscription `signature_key` is a random base64 string with no canonical
    literal prefix. Square's API ACCESS tokens (EAAA..., sq0csp-..., sandbox-sq0atb-...)
    do have prefixes but those are different artifacts handled by GitGuardian/TruffleHog
    (PROJECT.md scope). This DEVIATES from the plan's must_haves first bullet, which
    assumed Square has a canonical prefix; the action-step-2 verification carved the
    honest decision (documented in research/square.md).

  ALL_PREDICATES grows from 35 → 41 keys (6 new square-\* entries; no
  square-missing-timestamp-check key registered since the rule does not ship).
  docs/rule-coverage.md gains the square row.

  11 JS + 3 Python synthetic fixtures under test/fixtures/square/. test/square.test.ts
  adds 14 it() assertions.

  findings_delta:
  added: 6
  removed: 0
  severity_changes: []
  rationale: 'New square/\* rules. Corpus repos containing Square webhook handlers will newly emit findings for missing-sig-verif, timing-unsafe, raw-body, wrong-hmac, and unreachable-verif. The 6-rule additive count matches applicable_rules length in PROVIDER_CATALOG.square. Net Phase 6 delta: 7 (Shopify) + 7 (Twilio) + 7 (Slack) + 6 (Square) + 0 (06.1 refactor) = 27 new rules.'

## 0.1.1

### Patch Changes

- 0a0ff4c: Bundle the Python tree-sitter grammar (WASM) into the CLI's published tarball; remove `tree-sitter-python` as a runtime dependency.

  The `tree-sitter-python` npm package ships both a native binding and a WASM grammar artifact. hookwarden only uses the WASM path (via `web-tree-sitter`), but the native binding ran `node-gyp-build` at install time — failing on platforms without prebuilds (Alpine/musl, locked-down corporate environments) and adding install-time latency for everyone.

  Fix: `packages/cli/scripts/sync-wasm.mjs` copies `tree-sitter-python.wasm` into `packages/cli/wasm/` at install + pack time. The CLI loader reads from the bundled location instead of resolving the npm package at runtime. `tree-sitter-python` moves from `dependencies` → `devDependencies` on both `@hookwarden/engine` and `hookwarden` (CLI).

  Net effect for end users:

  - `npm i hookwarden` no longer triggers a native compile step. Works cleanly on Alpine, locked-down CI, and any environment without a C++ toolchain.
  - Tarball grows from 55 kB → 123 kB (gzipped) — the price of bundled portability.
  - Runtime behavior unchanged. Same WASM, same parser, same tests passing.

- 1fadc62: Fix `stripe/raw-body-misuse` false positive on the canonical Stripe happy-path pattern.

  The engine's `body_as_bytes_or_buffer` evidence signal previously searched the handler's arrow function body for raw-body indicators. But `express.raw({ type: 'application/json' })` is registered as an **inline per-route middleware argument** — _outside_ the arrow body — so the search missed it, even though the middleware was correctly resolved into `middleware_chain`.

  Result: `stripe/raw-body-misuse` fired as a critical finding on every codebase that uses Stripe correctly with the path-scoped `express.raw` pattern. The PI-3 integration test had been written around this — `expect(stdout).toContain("verified")` masked the fact that exit code was 1 and a critical FP was being emitted alongside the verified badge.

  **Fix:** Added `collectRawBodyMiddlewareEvidence` overlay in `packages/engine/src/model/build.ts` that follows the same pattern as the `sdkVerifyEvidence` overlay. When `middleware_chain` contains `express.raw` (qualified call) or `raw` (named import) AND the import source is `express` or `body-parser`, an evidence entry of kind `body_as_bytes_or_buffer` is appended. The `import_source` guard prevents false-negative matches from unrelated `raw` middleware on other routers.

  **Test:** PI-3 strengthened — now asserts exit 0, `stripe/library-verified` present, `stripe/raw-body-misuse` absent, and `counts.active.critical == 0` on the happy-path fixture. Full suite: 234/234 pass.

  Net effect for users: scanning a correct Stripe webhook handler that uses `express.raw` as a per-route middleware no longer emits a critical false positive. The `stripe/library-verified` (info, verified) finding still fires correctly to confirm the handler is verified.

## 0.1.0

### Minor Changes

- 0a15cd1: feat(engine, rules): add provider_docs_url + path_severity_overrides to RuleDefinition

  D-57 RULES-05: per-rule path_severity_overrides (post-emit severity rewrite, no state change).
  D-58 RULES-08: provider_docs_url required field on every rule.
  Engine ships pure-functional applyPathSeverityOverrides helper; rules schema bumps Ajv strict shape.
  Smoke-rule github/missing-timing-safe-equal.yaml updated to satisfy new required field.

- c7b39d1: Phase 4 — CLI distribution surface.

  The CLI is now usable in any CI environment:

  - `--format json` emits a versioned, sorted-keys JSON envelope (CLI-02; D-59)
  - `--format sarif` emits SARIF 2.1.0 conformant against the OASIS schema and uploads cleanly to GitHub Code Scanning (CLI-03 + CLI-11; D-60 + D-76)
  - Exit codes 0/1/2/3/4 with documented precedence 3 > 2 > 4 > 1 > 0 (CLI-04; D-65)
  - `--fail-on` severity threshold; suppressed findings never count (CLI-05; D-66)
  - Inline `// hookwarden-disable-next-line <rule-id>` comments (CLI-06; D-61)
  - `.hookwardenignore` (gitignore syntax) for path-level suppression (CLI-07; D-62)
  - `--diff-only` for CI acceleration (CLI-08; D-72 + D-74)
  - `--baseline write` / auto-read for non-greenfield adoption (CLI-10; D-68 + D-69 + D-70)
  - Bundle-inspection gate now runs on every release tag (CLI-09)
  - `hookwarden.config.yaml` config file with the full schema (D-75)

  Engine schema additive: `ScanMetadata` gains `parse_candidates_count` (D-64). `Finding` gains `suppressed` payload (D-63). Both additive — no breaking changes.

  Standalone binaries via `bun build --compile` (macOS arm64/x64, Linux x64/arm64, Windows x64) are deferred to Phase 4.x (D-73). Trigger to revisit: a measurable repeat-install metric on `npx hookwarden`, or a paying customer requesting an air-gapped install path.

### Patch Changes

- 89746ba: Engine `ScanMetadata` gains `parse_candidates_count: number` (D-64). Additive type bump; co-versioned across engine, rules, and CLI per D-05.
- 43379cb: Engine `Finding` gains optional `suppressed` payload (D-63: `{ source: "inline" | "ignore" | "baseline", pattern?, comment?, baselined_at? }`). Additive type bump; co-versioned across engine, rules, and CLI per D-05. CLI Phase 4 suppression annotator populates non-null values; engine emit sites set `suppressed: null` (or omit, since the field is optional).

## 0.0.1

### Patch Changes

- 7ffb431: Initial v0.0.1 release — defensive name registrations.

  Empty stubs for all 9 OSS package names (1 canonical + 4 scoped + 5 typo
  shims) to claim namespaces on npm before any public mention. Functional
  implementations land in subsequent versions.
