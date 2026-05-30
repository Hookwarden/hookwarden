# @hookwarden/fix

## 0.7.0

### Minor Changes

- v0.7.0 — Rule Depth. Five new rule classes that catch webhook-handler bugs beyond signature verification itself.

  **New rule classes** (87 new YAML rules across applicable providers):

  - **verify-after-side-effect** (VAS-01) — handler performs a DB write / outbound HTTP call / event emission BEFORE calling the SDK verification function. JS/TS only at v0.7.0, ships at `manual-review` verdict. All 21 providers.
  - **verification-error-swallowed** (ERS-01) — try/catch wraps the verify call but the catch handler doesn't terminate (no rethrow / 4xx response / next(err) / process.exit). Citation: Clerk GHSA-9mp4-77wg-rwx9. All 21 providers, `not-verified` HIGH.
  - **test-mode-bypass** (BYP-01) — `if (process.env.NODE_ENV !== 'production') return res.json({ok})` (or similar) appears BEFORE the verification call. All 21 providers, `not-verified` HIGH.
  - **secret-in-log-or-error** (LEAK-01) — webhook secret value leaks into `console.log` / `logger.*` / `throw new Error(...)`. 9-shape argument classifier distinguishes value-leaks (fires) from defensible patterns (boolean / length / hash → silent; small slice → manual-review). All 21 providers.
  - **replay-window-too-permissive** (RPL-01) — timestamp tolerance > provider spec maximum (300s for Stripe / Slack / Shopify / Standard Webhooks). Detects both manual time-diff comparisons and Stripe's explicit 4th-arg tolerance.

  **Engine foundation** (Phase 13):

  - New `WebhookEvidence.kind` variant `side_effect_before_verify` emitted by a per-handler CFG-lite overlay in `assembleHandler`.
  - 6 new optional `ProviderCatalogEntry` fields: `replay_tolerance_max_seconds`, `db_sink_calls`, `http_sink_calls`, `event_sink_calls`, `notification_sink_calls`, `provider_api_hosts`.
  - 3 new pure evaluator modules: `constant-fold.ts`, `secret-identifier.ts`, `side-effect-classifier.ts`.
  - New `model/handler-cfg.ts` linear-scan CFG-lite for JS/TS handler bodies.
  - New `references:` field in the YAML rule schema (additive) for CVE/GHSA citations.

  **CLI: `hookwarden update`** — new subcommand auto-detects install channel (brew / scoop / npm-global / npx / standalone-binary) and prints (or with `--yes`, runs) the channel-appropriate upgrade command.

  **Rule pack stats: 142 → 230 YAML rules** (+88). All new rules ship `fix.safety: manual-only`; auto-fix codemods deferred per FP-validation gate.

  **Deferred to v0.7.1:** Promotion of `verify-after-side-effect` from `manual-review` to `not-verified` after 200-handler corpus FP-rate confirms <5%. Python and PHP coverage for verify-after-side-effect. True branch-aware CFG (only if v0.7 corpus data justifies it).

### Patch Changes

- Updated dependencies
  - @hookwarden/engine@0.7.0

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
