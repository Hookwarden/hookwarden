# hookwarden

## 0.5.4

### Patch Changes

- Republish. 0.5.2 and 0.5.3 shipped with an unpublished/unusable `@hookwarden/fix`
  dependency, which left `npm i hookwarden` unable to resolve. 0.5.4 republishes the
  full package set with a correctly-resolved `@hookwarden/fix`. No functional changes
  versus 0.5.3 (multi-line `fix` codegen + color-coded summary tally).
  - @hookwarden/engine@0.5.4
  - @hookwarden/rules@0.5.4
  - @hookwarden/fix@0.5.4

## 0.5.3

### Patch Changes

- The scan/inventory summary tally is now color-coded per severity. The footer line
  `Found N critical · N high · N medium · N low · N info` previously rendered in plain
  foreground regardless of color mode; each segment is now painted in its palette colour
  (critical = red, high = orange, medium = amber, low = slate, info = blue), matching the
  per-finding glyphs. Plain output (`--no-color`, non-TTY, `NO_COLOR`, CI) is unchanged.
- a2e1946: `hookwarden fix` now applies the timing-unsafe-comparison fix on real multi-line handlers.

  The JS/TS codegen searched for the insecure `==`/`===` comparison only on the finding's
  own line — but findings are anchored to the handler declaration, while the comparison
  usually sits several lines into the body. As a result `fix` reported the finding but
  generated no edit ("0 fixable") for any normal handler; it only worked when the comparison
  happened to be on the handler's first line. The codegen now searches the handler's full
  line span and rewrites the sole `==`/`===` comparison it finds, declining only when the
  span contains more than one (ambiguous — a safe fixer never guesses).

- Updated dependencies [a2e1946]
  - @hookwarden/rules@0.5.3
  - @hookwarden/engine@0.5.3
  - @hookwarden/fix@0.5.3

## 0.5.2

### Patch Changes

- 4a2201b: Terminal output overhaul — clearer and more colorful:

  - **Truecolor palette.** CLI output now uses 24-bit truecolor from the brand palette (critical/not-verified `#F43F5E`, verified `#10B981`, medium/manual-review `#F59E0B`, high `#F97316`, info `#3B82F6`, `fix ›`/`docs ›` accent `#6366F1`, secondary `#64748B`) instead of the muted 16-color ANSI table.
  - **`--color always|never|auto`** flag (also honors `FORCE_COLOR`) to force or disable color independent of TTY detection.
  - **`--verbose` now shows its work** — lists every webhook handler found (provider · framework · verdict · file:line) before the findings, and appends `engine`/`rules` versions to the footer.
  - **Leaner default footer:** sub-second scans show `Scanned in 38 ms` (was a confusing `0.0 s`); engine/rule-pack versions moved to `--verbose`; a clean scan no longer prints an all-zeros severity tally.
  - **`info` gets a distinct `i` glyph** so it no longer collides with `low`'s `·`.
  - **Consistent fix lines:** framework-scoped fix paragraphs (`Fix (Express):`) are now extracted into a `fix ›` line instead of being buried in the explanation prose.

  Output format and JSON/SARIF envelopes are unchanged.

- 992b3d2: Fix three bugs that prevented the three-state verdict from displaying correctly:

  - **Engine: library-verified handlers now resolve to `verified`.** A handler whose only finding was a passing SDK verification (e.g. `stripe.webhooks.constructEvent`) was pinned to the `manual-review` baseline, so its finding line said `verified` while the inventory column said `[manual-review]`. The handler verdict now trusts the rules' aggregate when any rule fires, and only falls back to `manual-review` when nothing is found.
  - **Rules: `stripe/express-middleware-ordering` no longer fires cross-provider.** The Stripe-namespaced rule matched any Express handler with `express.json()` before the route, emitting a Stripe-branded finding on (e.g.) a GitHub webhook — a false positive. Each provider's own `raw-body-misuse` rule already covers this, so the rule is now scoped to Stripe handlers.
  - **CLI: `hookwarden inventory` no longer leaks a literal `[1m` in the header.** The bold escape was missing its `\x1b`, so color-mode output printed `[1mframework … file:line[0m` as text instead of bolding the header row.

  Exit codes, JSON, and SARIF envelopes are unchanged.

- Updated dependencies [992b3d2]
  - @hookwarden/engine@0.5.2
  - @hookwarden/rules@0.5.2
  - @hookwarden/fix@0.5.2

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
  - @hookwarden/engine@0.5.1
  - @hookwarden/rules@0.5.1
  - @hookwarden/fix@0.5.1

## 0.5.0

### Minor Changes

- 66814fc: v0.5.0 rollup: auto-remediation engine + macOS Homebrew + release-tooling depth.

  **`hookwarden fix` auto-remediation engine.** New `fix` subcommand that
  mechanically rewrites the `safety: safe` subset of findings across JS/TS,
  Python, and PHP. Atomic staging at `.hookwarden-fix-staging/<run-id>/`,
  forbidden-range mask that never touches template literals / triple-quoted
  strings / heredocs / comments, sequential conflict resolver, and a versioned
  JSON schema at `https://hookwarden.dev/schemas/fix-output.v1.json`. Three
  safety modes (`safe` / `all` / `manual-only-explain`); `--mode all` refuses
  in non-TTY without `--accept-unsafe`. Engine purity preserved — `@babel/traverse`
  and `@babel/generator` are bounded to `packages/fix/` only, verified by both
  the dep-cruiser rule and a new dist-grep purity test.

  **`brew install hookwarden/tap/hookwarden` now works on macOS.** Linux
  formula continues to pull the bun-compiled standalone binary; macOS formula
  installs the published npm tarball under `libexec` and symlinks the
  `hookwarden` command into your `PATH` — same engine, same rule pack, same
  outputs. Adds `node` as a runtime dep on macOS (brew handles transparently).
  No signed darwin binary ships, since Apple Developer Program enrollment for
  notarisation is still unfunded; direct-download macOS users should install via
  brew or `npx` to avoid Gatekeeper friction.

  **Release-tooling test depth: 14 → ~180 named cases.** Each forbidden symbol,
  forbidden runtime dep, dep-cruiser rule, and parity-gate divergence pattern
  now has its own named test row — a CI failure pinpoints exactly which
  invariant broke instead of "violations: [...]". Coverage matrix:
  `bump-homebrew-edit` 7→20, `verify-channel-parity` 6→15, `docker-smoke-binaries`
  42→60 (now includes Laravel-shaped PHP + `inventory` + `explain` rows), engine
  purity gates 10→85 (per-symbol + per-dep + per-rule pinpointing + dynamic-require
  evasion guard).

  **Docs sweep.** README install table now shows `brew install` as the
  recommended path on both Linux and macOS; "Real output" section rewritten
  verbatim from the CLI (no more stylised mockups) with the canonical Express
  middleware-ordering case showing why one bug surfaces 3 rule names; new PHP
  output example proving the v0.4 third-language claim visually. `demo.gif`
  regenerated with a PHP frame; new `assets/brand/record-demo.sh` makes the
  demo reproducible.

### Patch Changes

- @hookwarden/engine@0.5.0
- @hookwarden/rules@0.5.0
- @hookwarden/fix@0.0.1

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
  - @hookwarden/engine@0.4.0
  - @hookwarden/rules@0.4.0

## 0.3.1

### Patch Changes

- 2496be2: Release pipeline: `bump-homebrew.sh` updated to handle the Linux-only formula shape introduced in v0.3.0 (deferred macOS binaries; see [Hookwarden/homebrew-tap#1](https://github.com/Hookwarden/homebrew-tap/pull/1)).

  Two changes coupled to the new formula shape:

  - Drop `SHA_DARWIN_ARM` / `SHA_DARWIN_X64` extraction (mirrors `stamp-checksums.py`'s `REQUIRED_TARGETS` pattern: explicit Linux-only list, fail-fast on missing pins).
  - Replace `sed -i.bak ... version "X.Y.Z"` with `sed -i.bak ... releases/download/vX.Y.Z` — the new formula has no explicit `version` line (auto-derived from the top-level URL to satisfy `brew audit --strict` style ordering). Version updates ride the URL substring.

  No user-facing CLI changes — internal release-tooling fix. Closes the v0.3.0 onion-peel bug 7 from [#12](https://github.com/Hookwarden/hookwarden/issues/12). Bugs 1–6 (negative-test coverage) will follow in a separate PR.

  - @hookwarden/engine@0.3.1
  - @hookwarden/rules@0.3.1

## 0.3.0

### Minor Changes

- f72331f: Distribution channels — Linux + Windows.

  v0.2.0 was npm-only. v0.3.0 begins channel fan-out for Linux + Windows via four new install paths, all sourced from the same `bun build --compile` binary SHA enforced by the release-pipeline channel-parity gate:

  - `brew install hookwarden` — Homebrew tap (Linux only)
  - `scoop install hookwarden` — Scoop bucket (Windows)
  - `winget install hookwarden` — WinGet manifest (Windows)
  - `pip install hookwarden` — PyPI binary-fetcher shim (Linux + Windows)

  Windows binaries are Authenticode-signed via Azure Trusted Signing (federated OIDC, no static signing cert).

  **macOS is intentionally not included in v0.3.0.** Apple Developer Program enrollment is not funded for this release; macOS users continue using `npx hookwarden`. The Homebrew tap and PyPI shim both fall back to recommending `npx hookwarden` on macOS. The macOS binary surface is deferred to a future funded release.

### Patch Changes

- 08fb590: Refresh README on npm: switch badge accent from `#6366F1` to deeper indigo `#4F46E5` (resolves indigo-vs-violet ambiguity in shields.io rendering), and sync the CLI package README with the root GitHub README — banner, provider matrix, comparison table, architecture diagram, and advanced-usage collapsibles. Asset URLs rewritten to absolute `raw.githubusercontent.com` / `github.com` paths so they resolve on npmjs.com.

  No code changes. Docs-only patch — included to trigger an npm refresh of the package README.

- 442f0b9: Fix npm-page banner: swap `raw.githubusercontent.com` → `cdn.jsdelivr.net` for the readme-banner SVG. GitHub's raw endpoint sets `Content-Security-Policy: ... sandbox` on SVG responses, which npmjs.com's iframe renderer refuses to load. jsDelivr serves the same file with permissive CORS and no sandbox header.

  No code changes. Docs-only patch.

  - @hookwarden/engine@0.3.0
  - @hookwarden/rules@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [b32262e]
- Updated dependencies [961b967]
- Updated dependencies [0bf95c1]
- Updated dependencies [f28136e]
- Updated dependencies [5c5811f]
  - @hookwarden/engine@0.2.0
  - @hookwarden/rules@0.2.0

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

- Updated dependencies [0a0ff4c]
- Updated dependencies [1fadc62]
  - @hookwarden/engine@0.1.1
  - @hookwarden/rules@0.1.1

## 0.1.0

### Minor Changes

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
- Updated dependencies [0a15cd1]
- Updated dependencies [89746ba]
- Updated dependencies [43379cb]
- Updated dependencies [c7b39d1]
  - @hookwarden/engine@0.1.0
  - @hookwarden/rules@0.1.0

## 0.0.1

### Patch Changes

- 7ffb431: Initial v0.0.1 release — defensive name registrations.

  Empty stubs for all 9 OSS package names (1 canonical + 4 scoped + 5 typo
  shims) to claim namespaces on npm before any public mention. Functional
  implementations land in subsequent versions.

- Updated dependencies [7ffb431]
  - @hookwarden/engine@0.0.1
