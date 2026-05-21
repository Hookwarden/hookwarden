# hookwarden

Project-level release notes. Per-package Changesets entries (engine, rules,
cli, github-action) live in each package's own `CHANGELOG.md`.

## Unreleased

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
