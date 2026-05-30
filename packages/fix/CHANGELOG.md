# @hookwarden/fix

## 0.6.0

### Minor Changes

- c81cc40: Phase 8.3 rule pack expansion. 15 new provider rule packs (Zendesk, DocuSign,
  Intercom, Linear, HubSpot, Auth0, Mailchimp, Postmark, Datadog, Sentry,
  PagerDuty, Bitbucket, Notion, Calendly, Zoom) + CVE-2026-41432 Stripe
  empty-secret bypass detector (JS/TS variants 1, 2, 3, 6 — variants 4 + 5 +
  Python + PHP deferred to Plan 17b) + CVE-CORPUS-01 with 5 fixture pairs and a
  drift-guard test asserting every CVE in the public corpus maps to a registered
  rule. Effective provider coverage 9 → ~31 (including Standard Webhooks
  conformant providers swept in via Phase 8.3 Plan 16). 517 → 700 rule pack
  tests. See CHANGELOG.md for the full release notes.

### Patch Changes

- Updated dependencies [c81cc40]
  - @hookwarden/engine@0.6.0

## 0.5.5

### Patch Changes

- Updated dependencies [80c46ef]
- Updated dependencies [3217cec]
  - @hookwarden/engine@0.5.5

## 0.5.4

### Patch Changes

- @hookwarden/engine@0.5.4

## 0.5.3

### Patch Changes

- @hookwarden/engine@0.5.3

## 0.5.2

### Patch Changes

- Updated dependencies [992b3d2]
  - @hookwarden/engine@0.5.2

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

## 0.0.1

### Patch Changes

- @hookwarden/engine@0.5.0
