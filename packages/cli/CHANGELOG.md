# hookwarden

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
