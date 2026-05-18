---
"hookwarden": minor
---

Distribution channels — Linux + Windows.

v0.2.0 was npm-only. v0.3.0 begins channel fan-out for Linux + Windows via four new install paths, all sourced from the same `bun build --compile` binary SHA enforced by the release-pipeline channel-parity gate:

- `brew install hookwarden` — Homebrew tap (Linux only)
- `scoop install hookwarden` — Scoop bucket (Windows)
- `winget install hookwarden` — WinGet manifest (Windows)
- `pip install hookwarden` — PyPI binary-fetcher shim (Linux + Windows)

Windows binaries are Authenticode-signed via Azure Trusted Signing (federated OIDC, no static signing cert).

**macOS is intentionally not included in v0.3.0.** Apple Developer Program enrollment is not funded for this release; macOS users continue using `npx hookwarden`. The Homebrew tap and PyPI shim both fall back to recommending `npx hookwarden` on macOS. The macOS binary surface is deferred to a future funded release.
