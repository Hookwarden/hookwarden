---
"@hookwarden/engine": patch
"@hookwarden/rules": patch
"@hookwarden/fix": patch
"@hookwarden/github-action": patch
"hookwarden": patch
"hook-warden": patch
"hookwardn": patch
"hookwardne": patch
"hookwardens": patch
"hookwarden-cli": patch
---

Emergency patch — v0.5.1.

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
