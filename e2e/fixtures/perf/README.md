# Phase 2 perf fixture (50K LOC)

Synthetic mixed JS/TS + Python codebase used by the engine's perf integration test
(`packages/engine/test/integration/perf-50k.test.ts`). Used to assert ENGINE-06 (≤30s scan
on a developer laptop) and ENGINE-09 (route detection across all 7 supported frameworks).

**Why synthetic, not curated OSS:**
- CI determinism — the same scan output every run.
- License clean — no upstream code checked in; the generator is original.
- Reproducible — `pnpm exec tsx e2e/fixtures/perf/generate.ts` regenerates from scratch.

**Coverage:**
- Express (TS) — webhook handlers
- Hono (TS)
- Fastify (TS)
- Next.js (TS) — `app/api/webhooks/*/route.ts`
- Flask (Python)
- FastAPI (Python) — including cross-file `include_router(prefix=...)`
- Django (Python) — class-based views + `urls.py`
- One file with a deliberate syntax error (parse-error coverage per ENGINE-07)
- One file with `@octokit/webhooks-methods.verify()` (verified-via-SDK)

The corpus targets ~50,000 lines of code. Each file's expected behavior is recorded in
`manifest.json` so the integration test can spot-check coverage without re-discovering it.

The `generated/` tree is gitignored — regenerate before running the integration test.
