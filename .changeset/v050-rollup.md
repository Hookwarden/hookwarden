---
"hookwarden": minor
---

v0.5.0 rollup: auto-remediation engine + macOS Homebrew + release-tooling depth.

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
