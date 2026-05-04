# hookwarden

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
