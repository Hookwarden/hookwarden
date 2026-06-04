# Adding a language to hookwarden

This is the reusable playbook for teaching hookwarden a new source language (Ruby, Java, C#, …).
It was distilled from the four shipped tree-sitter languages — Python, PHP, **Go (Phase 27)** — and
is structured as **five touchpoints**. Each touchpoint lists the closest existing analog to mirror,
the files you create/modify, and the compiler- or test-enforced gate that proves you did it.

The north star: a new language should be **mechanical**. Mirror the PHP files (PHP is the most
recent full tree-sitter language and the best analog), let `tsc` tell you every switch arm you
forgot, and let the gates below stop you from shipping a silent gap.

> Convention used below: `<lang>` = your new language (e.g. `ruby`), `tree-sitter-<lang>` = its
> dialect tag, `<Lang>` = PascalCase (e.g. `Ruby`).

---

## Before you start — two HARD gates, in order

These are not optional and they have a required ORDER. They exist because each was a real,
expensive failure in a prior language.

1. **Verify the grammar's `node-types.json` BEFORE you key on any node-type string** (Pitfall 5).
   tree-sitter grammars rename node types between versions. Dump the installed grammar's
   `src/node-types.json` and confirm every string you will switch on actually exists, with the
   field names you expect. Cite the confirmed grammar version in a header comment in your parser
   (as `go.ts` cites `tree-sitter-go@0.25.0 node-types.json`). Pin the grammar **exactly** (no
   caret) — mirror the existing `"tree-sitter-php": "0.24.2"` pin in both `packages/engine` and
   `packages/cli` `package.json`.

2. **Pass the `bun build --compile` WASM smoke test BEFORE authoring any rules** (Pitfall 1).
   The compiled standalone binary's `/$bunfs/` virtual FS cannot `locateFile` the runtime `.wasm`.
   The `treeSitterRuntimeWasmBytes` injection in your `<lang>-loader.ts` handles it — but it MUST
   be smoke-tested on a real compiled binary (locally where `bun` is present, else in the
   `release-binaries.yml` CI matrix), not assumed. PHP and Go both hit this exact bug. **Rule
   authoring (Touchpoint 4+) is blocked until a compiled binary parses a `<lang>` fixture and
   emits a finding** (not a "Could not resolve … .wasm" error, not a null tree).

Also up front: package legitimacy. Before installing the grammar, confirm the author/maintainer is
the canonical tree-sitter team (the Go/Python/PHP grammars are all `maxbrunsfeld` et al.), the repo
is `github.com/tree-sitter/tree-sitter-<lang>`, the license is permissive, and the tarball ships the
`.wasm` artifact (`npm pack <pkg> --dry-run`).

---

## Touchpoint 1 — Parser

**Analog:** `packages/engine/src/parsers/php.ts`, `php-loader.ts`, `php-literals.ts`.

**Create:**
- `packages/engine/src/parsers/<lang>.ts` — `parse<Lang>(input, runtime): Promise<ParsedFile>`.
  Copy `parsePhp`'s shape: `language`/`dialect` stamping, the **D-27 all-or-nothing** parse-error
  surfacing (copy `findFirstError` verbatim, swap the message literal), and `extractImports`
  (replace the body to walk your grammar's import nodes into `ImportEdge`s).
- `packages/engine/src/parsers/<lang>-loader.ts` — copy `php-loader.ts` **byte-for-byte**, swapping
  identifiers. KEEP the `treeSitterRuntimeWasmBytes?` optional + the `Parser.init({ wasmBinary })`
  branch — that is the `bun --compile` injection from Gate 2.
- `packages/engine/src/parsers/<lang>-literals.ts` — emit `LiteralSpan[]` for the redactor. Drop
  any interpolation handling the language doesn't have (Go has none; every string span is
  `kind:"string"`).

**Modify:** `packages/engine/src/parsers/index.ts` AND `packages/engine/src/index.ts` (the **public**
barrel — easy to miss; the CLI imports `parse<Lang>`/`init<Lang>Runtime` from the public surface).

**Gate:** `packages/engine/test/parsers/<lang>.test.ts` — valid source → imports extracted; malformed
source → a parse-error finding (the D-27 negative test, mandatory).

---

## Touchpoint 2 — Adapters + Reachability

**Analog:** `packages/engine/src/adapters/vanilla-php.ts` (heuristic catch-all),
`symfony.ts` (import-gated), `packages/engine/src/model/reachability.ts` (`collectCallsPython`).

**Create:**
- A **heuristic** adapter (`<lang>-...-<framework>.ts`) that qualifies a webhook handler on **≥1
  receiving signal** — a raw-body read, an HMAC construction, a signature-header read, OR a known
  SDK verify call. The bare handler signature alone must NOT qualify (Pitfall 6 — over-emission).
- **Import-gated** framework adapters for the language's routers (Go: chi/gin/echo). These run
  BEFORE the heuristic catch-all in `ALL_ADAPTERS`, and the heuristic adapter import-negative-gates
  those same framework prefixes — so each file is owned by exactly one adapter (mirrors
  symfony-before-vanilla).
- Adapters re-declare their own structural `<Lang>SyntaxNode` interface — they MUST NOT import
  `web-tree-sitter` (engine purity D-01).

**Modify:**
- `packages/engine/src/adapters/index.ts` — register both, framework-gated first.
- `packages/engine/src/model/reachability.ts` — add `collectCalls<Lang>` to the `collectCalls`
  dialect switch AND a `tree-sitter-<lang>` branch to `buildSymbolTable` (index top-level
  functions/methods by name). This is what resolves **helper-extracted verification** (`handler →
  verifyX() → hmac.Equal`). This is the only place reachability grows per language.
- `packages/engine/src/model/evidence.ts` — `computeEvidence` is **text-based and dialect-agnostic**,
  so `signature_header_read` works for free. But Signal F's raw-body regex is per-dialect: add your
  language's raw-body tokens (Go added `io.ReadAll` / `ioutil.ReadAll` / `GetRawData`).

**The attribution guard (dub-scan lesson, MEMORY project_real_app_fp_audit_attribution):** a handler
whose only provider signal is an SDK *import* is demoted to `provider:"unknown"` unless it also
carries a **receiving signal** (`signature_header_read` / `body_as_bytes_or_buffer` /
`sdk_verify_call`) or sits at a webhookish path. Make sure your adapter + evidence emit a receiving
signal for real handlers, or correct handlers silently fall through to `unknown`.

**Gate:** an adapter test with an **over-emission negative** (signature-only file → no handler) and a
reachability test (helper-extracted verify resolves; the middleware continuation symbol surfaces).

---

## Touchpoint 3 — CLI wiring

**Analog:** the PHP branches in `packages/cli/src/pipeline.ts`, `commands/fix.ts`,
`wasm/loader.ts`, `wasm/bun-asset.ts`, `scripts/sync-wasm.mjs`, `walker/extensions.ts`.

**Modify:**
- `walker/extensions.ts` — add the file extension(s) to `EXTENSION_ALLOWLIST`.
- `pipeline.ts` — add `is<Lang>()`, a `has<Lang>` check, `load<Lang>WasmBytes()` into the
  `Promise.all`, `init<Lang>Runtime(...)` (forwarding the shared `treeSitterRuntimeWasmBytes`), and a
  parse dispatch branch. The shared `web-tree-sitter` runtime loads once regardless of grammar count.
- `commands/fix.ts` — add the `need<Lang>` block + parse branch.
- `wasm/loader.ts` + `wasm/bun-asset.ts` — `load<Lang>WasmBytes` (Node + Bun branches) and
  `loadBunEmbedded<Lang>Wasm`.
- `scripts/sync-wasm.mjs` — `copyAsset(...)` for `tree-sitter-<lang>.wasm`. Run it so
  `packages/cli/wasm/tree-sitter-<lang>.wasm` is populated (gitignored) before the bun smoke test.

> Note: the CLI package is named **`hookwarden`** (not `@hookwarden/cli`) — filter with
> `pnpm --filter hookwarden`. There is no per-package `build` script; the build is the **root**
> `pnpm build` (`tsc --build` over project references).

**Gate:** run the built Node CLI on a `<lang>` fixture and confirm it parses (a malformed file yields
a parse-error finding) — then Gate 2 (bun --compile) on the shipped targets.

---

## Touchpoint 4 — Rules (the verdict logic)

**Analog:** `packages/rules/src/catalog.ts`, `predicates/_helpers-php.ts`,
`predicates/stripe-php-timing-unsafe-comparison.ts`, the timing + `library-verified` YAMLs.

### 4a. Framework-name declarations — a HARD sync invariant

A new language's framework names (Go: `net-http-go`/`chi`/`gin`/`echo`) MUST be added to **BOTH**:
- the engine `Framework` union in `packages/engine/src/types/handler.ts`, and
- the Ajv `applies_to` enum in `packages/rules/src/schema.ts`.

These move together or **rule loading throws** at startup (a fail-closed hard outage). Both files
carry a "MUST stay in sync" comment; the existing rule-loading test gates the invariant.

### 4b. Catalog SDK shapes

Extend `PROVIDER_CATALOG` per provider with the language's SDK packages + verify calls. Watch the
matching convention: JS = exact module match, PHP = `\`-namespace prefix, **Go = import-path PREFIX**
(domain-prefixed module path, tolerating a `/vNN/` version segment — `isGoImportPath` in
`evidence.ts`). Package-qualified verify calls (`webhook.ConstructEvent`) resolve via reachable
symbols; receiver-varying instance methods (`wh.Verify`) need an **import-gated overlay** in
`build.ts` (`collectGoSdkVerifyEvidence`) matched by exported func-name suffix so import aliases
(`gh "…/go-github"`) don't defeat the match.

### 4c. The constant-time predicate — null-on-safe-path

Author `_helpers-<lang>.ts` + per-provider timing predicates. Two non-negotiable disciplines:

- **A critical predicate returns `null` on the safe path and can NEVER return `"verified"`**
  (MEMORY project_critical_rule_safe_path_must_return_null). `"verified"` is a pipeline STATE
  emitted by the info-severity `library-verified` rule, not a predicate return value. Grep-gate it:
  the literal `"verified"` must not appear in any critical predicate's source.
- **Predicate RESULT (`null` | `"not-verified"`) is distinct from the pipeline STATE (`verified`).**
  Unit tests assert the predicate result (`toBeNull()`, never `toBe("verified")`); the `verified`
  state is proven separately at the CLI against an SDK fixture.
- Classify the language's compare primitives correctly: in Go, `hmac.Equal` is the ONLY
  constant-time MAC compare; `bytes.Equal` is result-correct but NON-constant-time — it IS the
  CWE-208 bug (Pitfall 2). Do not let structural similarity mark the unsafe primitive safe.

If your timing rule reuses a dialect-multiplexed factory (Go added a "Path C" to
`createTimingUnsafeComparisonPredicate` and `github-timing-safe-equal`, mirroring the PHP "Path B"),
just add a `tree-sitter-<lang>` branch — the existing YAML fires on the new language once you add the
framework names to its `applies_to`.

### 4d. `library-verified` applies_to — the verified STATE

Add the language's framework names to each provider's `library-verified.yaml` `applies_to`
(Go: stripe + github + standardwebhooks). **Without this, an SDK-verified handler falls through to
`manual-review` instead of `verified`** — it carries the `sdk_verify_call` evidence but no rule fires
to turn it into the verified state.

> **After editing ANY rule YAML, run `node packages/rules/scripts/sync-bundle.mjs`.** The CLI loads
> **build-time-bundled** rule docs, not the YAML files at runtime — your `applies_to` edits are
> invisible to `hookwarden scan` until the bundle is regenerated (the bundle is gitignored, so don't
> commit it). This is silent: handlers render `manual-review` with no error while the rules-package
> unit tests (which load YAML directly) pass.

**Gate:** `pnpm --filter @hookwarden/rules test` (the union ↔ enum sync test + your predicate tests).

---

## Touchpoint 5 — Fix (autofix)

**Analog:** `packages/fix/src/php/rewriter.ts`, `packages/rules/src/fix/php-replace-*.ts`,
`packages/fix/src/forbidden-ranges.ts`, `import-inserter.ts`, `dispatchers.ts`.

**Create/modify:**
- `packages/fix/src/<lang>/rewriter.ts` — copy `rewritePhp`, swap the dialect guard + error strings.
  It is a standalone tested primitive; do NOT re-export it from `fix/src/index.ts` (the live
  `applyFixes` path uses the language-agnostic text-range-applier + `buildForbiddenRanges`).
- `forbidden-ranges.ts` — add `<LANG>_FORBIDDEN_NODE_KINDS` (comments + every string/char literal
  kind) + a `walk<Lang>` arm + the dialect-selector case. The fixer must NEVER edit inside a
  comment/string (mandatory negative tests — MEMORY feedback_negative_tests_required).
- `packages/rules/src/fix/<lang>-replace-*.ts` — the codegen routines. **Search the handler's full
  line span and require a SOLE target** — the finding anchors to the handler DECLARATION line, but
  the comparison lives several lines into the body (mirror `typescript-replace-binary-equality`'s
  `findSoleBinaryInHandler`; a single-line search produces zero fixes). A safe fixer never guesses
  which comparison is the signature check. Emit `importsToAdd` only when the import is absent.
- `import-inserter.ts` — add a `<lang>` branch if a codegen needs a new import (Go inserts into a
  grouped `import (...)` block). If insertion can't be done cleanly, the codegen ships `manual-only`.
- `dispatchers.ts` — wire the `case "tree-sitter-<lang>":` arms to the real codegen (they start as
  `null` placeholders that satisfy `tsc` exhaustiveness when you first extend the dialect union).
- Classify conservatively: if a transform isn't a clean single-range replace (Go raw-body misuse is a
  multi-statement restructure), emit `safety:"manual-only"` rather than a risky `"safe"` edit.

**Gate:** `rewriter.test.ts` (forbidden-range refusals) + per-codegen tests + an E2E
`hookwarden fix` dry-run that proposes the fix and edits no strings/comments.

---

## The completeness gate (why this is mechanical)

Extending the `dialect` union in `project-model.ts` is the load-bearing move: the TypeScript compiler
then **forces** a `case "tree-sitter-<lang>":` arm in every exhaustive switch — the four
`dispatch*` switches in `dispatchers.ts`, the `forbidden-ranges.ts` selector, and the reachability
switches. `pnpm build` failing IS your checklist of what's left. Combined with the two HARD gates
(node-types verification, bun-compile smoke test), the union ↔ enum sync invariant, the `library-verified`
`applies_to` requirement, the null-on-safe-path discipline, the receiving-signal attribution guard, and
the `sync-bundle.mjs` step, a new language is a fill-in-the-blanks pass over five touchpoints.

## Ship gate

Before shipping the language: a curated corpus with a **<5% high/critical false-positive rate** on
the safe-form (`.negative.`) fixtures (RULES-06), plus a CLI round-trip proving both directions — a
broken hand-rolled compare → critical `not-verified`, and an SDK-verified handler → `verified`. Every
corpus fixture must be webhookish with a **detectable handler** (verify with `scan --verbose`), or the
FP gate passes vacuously on zero findings.

---

### Per-language checklist (Ruby / Java / C# become mechanical)

| # | Touchpoint | Mirror these PHP files | Create for `<lang>` |
|---|-----------|------------------------|---------------------|
| 1 | Parser | `php.ts`, `php-loader.ts`, `php-literals.ts` | `<lang>.ts`, `<lang>-loader.ts`, `<lang>-literals.ts` (+ barrels, dialect+language union) |
| 2 | Adapters + Reachability | `vanilla-php.ts`, `symfony.ts`, `collectCallsPython` | heuristic + import-gated adapters, `collectCalls<Lang>` + `buildSymbolTable` arm, evidence raw-body tokens |
| 3 | CLI wiring | pipeline/fix/loader/bun-asset/sync-wasm PHP branches | `is<Lang>`, `load<Lang>WasmBytes`, sync-wasm copy, `.ext` allowlist |
| 4 | Rules | `catalog.ts`, `_helpers-php.ts`, `*-php-timing-*.ts`, timing + `library-verified` YAMLs | `Framework` union + Ajv enum names, catalog SDK shapes, `_helpers-<lang>.ts` + timing predicates, `library-verified` applies_to (+ `sync-bundle.mjs`) |
| 5 | Fix | `php/rewriter.ts`, `php-replace-*.ts`, forbidden-ranges, dispatchers | `<lang>/rewriter.ts`, `<lang>-replace-*.ts`, `<LANG>_FORBIDDEN` + `walk<Lang>`, dispatcher arms |
