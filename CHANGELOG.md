# hookwarden

Project-level release notes. Per-package Changesets entries (engine, rules,
cli, github-action) live in each package's own `CHANGELOG.md`.

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
