# hookwarden-cli

## 0.8.1

### Patch Changes

- hookwarden@0.8.1

## 0.8.0

### Patch Changes

- Updated dependencies [8f8c131]
- Updated dependencies [a7424fc]
- Updated dependencies [46c2a97]
- Updated dependencies [ade4609]
- Updated dependencies [056ba21]
- Updated dependencies [c7f1046]
- Updated dependencies [729c7a1]
- Updated dependencies [1bd1791]
- Updated dependencies [c10427a]
  - hookwarden@0.8.0

## 0.8.0-beta.2

### Patch Changes

- Updated dependencies [8f8c131]
- Updated dependencies [ade4609]
- Updated dependencies [c7f1046]
- Updated dependencies [729c7a1]
  - hookwarden@0.8.0-beta.2

## 0.8.0-beta.1

### Patch Changes

- Updated dependencies [a7424fc]
- Updated dependencies [056ba21]
- Updated dependencies [1bd1791]
- Updated dependencies [c10427a]
  - hookwarden@0.8.0-beta.1

## 0.8.0-beta.0

### Patch Changes

- Updated dependencies
  - hookwarden@0.8.0-beta.0

## 0.7.5

### Patch Changes

- Updated dependencies
  - hookwarden@0.7.5

## 0.7.4

### Patch Changes

- ## v0.7.4 — Update-availability prompts + release-gate fix

  ### Update-availability check (PostHog-style)

  Users on `npm i -g hookwarden@<old>` had zero signal that newer rule packs existed. Today (2026-05-30) we shipped 0.7.0 → 0.7.3 with no in-CLI prompt. This release closes that gap.

  After every text-format scan, if a newer hookwarden is on npm:

  ```
  ─────────────────────────────────
  Update available: 0.7.0 → 0.7.4 (patch)
  Run: npm i -g hookwarden@latest
  ```

  - **Background fetch, never blocking.** Check happens in parallel with the scan; banner renders post-scan if the result is ready.
  - **24h cached** via update-notifier's local config store — repeated invocations don't re-hit npm.
  - **TTY-gated.** Auto-skipped in CI, `NO_COLOR`, non-TTY stderr (piped / captured), and for `--format json` / `--format sarif`.
  - **Opt-out** via `--no-update-notifier` flag.
  - **Brand boundary preserved.** The update check IS a network call — but it queries npm for hookwarden's own version, never sees your scan data, never touches user code. The "zero network during scan" promise applies to the scan, not to "does hookwarden itself need updating."

  Powered by `update-notifier` (Sindre Sorhus' canonical library — same one npm, Vue/Angular/Nest CLIs, Yeoman, and PostHog all use). hookwarden renders its own banner via the low-level API to keep the tone aligned with the rest of the audit-grade output.

  ### Release-pipeline gate — fix the false-negative

  `Verify @hookwarden/mcp installability` failed on every release since v0.8.0 with `Cannot read properties of null (reading 'matches')` — even though the package was always fully installable (verified in clean Docker each time). The culprit was `npm install --dry-run`'s upstream bug.

  Swapped to `npm pack --dry-run`, which exercises the tarball-fetch path without invoking the install-time resolver. Same "is this really published?" gate without the false negative. Combined with the v0.7.3 propagation poll (90s window), the gate should now report green when — and only when — the publish actually landed.

  ### Not changed

  - No new rule classes, no new providers
  - Default scan output (no `--verbose`) unchanged
  - `@hookwarden/mcp` is not in the fixed group; ships v0.8.5 via transitive patch (re-bundles updated rule pack)
  - The update notifier wraps the npm-install case; brew/scoop already have their own `brew outdated` / `scoop status` flows

- Updated dependencies
  - hookwarden@0.7.4

## 0.7.3

### Patch Changes

- ## v0.7.3 — Verbose-mode CLI redesign + trivia ticker + release hardening

  ### `hookwarden scan --verbose` — Stitch CLI design (visual redesign)

  Default mode is unchanged. `--verbose` now renders the polished audit-grade layout:

  - **Provenance banner** at the top (3 lines, box-drawing):

    ```
    ╭─ hookwarden v0.7.3 · engine 0.7.3 · rules 0.7.3 (e05c30e8…)
    │  230 rules · 100% cited · 21 providers · local · zero network
    ╰─ scope: ./apps/webhooks · 7 handlers · 4 files
    ```

  - **Severity section dividers** (`─── critical ───`) grouping findings — empty groups skipped.

  - **2-line finding header** instead of crammed one-liner:

    ```
    × not-verified                stripe/express-middleware-ordering
      server.js:10:1                              (high confidence)
    ```

  - **FIX box** wraps the fix prose in box-drawing with the rule's safety label on the open line — instantly tells the reader whether `hookwarden fix --write` can apply this mechanically or whether human judgment is required:

    ```
    ╭ FIX (manual-only)
    │  Register express.json() AFTER the webhook route, OR mount
    │  express.raw({type: 'application/json'}) on the path only.
    ╰
    ```

  - **Verdict tally + exit-code line** in the summary footer:
    ```
    3 critical · 0 high · 0 medium · 0 low · 0 info · 2 manual-review
    1 verified · 4 not-verified · 2 manual-review
    Exit: 1 (fail-on=high)
    ```

  The severity tally tells you blast radius; the new verdict tally tells you confidence distribution. Two complementary axes.

  ### Trivia ticker — rotating webhook-security tips during long scans

  PostHog-style stderr ticker that rotates ~35 webhook-security tips every 3 seconds, starting only after a scan has run for 1+ seconds (so fast scans never see it). TTY-gated — auto-disabled in CI, `NO_COLOR`, or when stderr is piped. Opt out with `--no-trivia`.

  Zero-network: every tip is a string literal in `packages/cli/src/trivia.ts`. Sample tips:

  - "Stripe's signature tolerance defaults to 300s. Wider = `replay-window-too-permissive`."
  - "Twilio is the SHA-1 outlier. Every other major provider in the rule pack uses SHA-256."
  - "Hookwarden has never made a network call during a scan. Run `lsof -p` if you don't trust us."
  - "CVE-2026-41432: a Stripe webhook with an empty secret accepts everything. Flagged on every scan."

  ### Release pipeline — install-verify gate hardened

  The "Verify @hookwarden/mcp installability" post-publish gate has failed on every release since v0.8.0 with `Cannot read properties of null (reading 'matches')` — npm's publish endpoint and read CDN are different layers; the read side can lag 30–90s after `changeset publish` returns 200.

  A flat `sleep 30` wasn't enough on v0.7.2. The gate now polls `npm view @hookwarden/mcp@<just-published-version>` in a retry loop (up to 9 attempts, 10s apart, max ~90s) until the exact version is queryable, then runs the dry-run install against that pinned version. The pin is also a stronger gate — proves THIS publish landed, not just "any version of the package."

  ### Not changed

  - No new rule classes, no new providers, no rule re-grading
  - Default `hookwarden scan` output (no `--verbose`) unchanged — every existing test, snapshot, and CI integration sees the same shape
  - SARIF renderer not yet updated for the Stitch design (SARIF is a structured format and doesn't benefit from the visual changes; the JSON envelope already carries every field SARIF consumers need)
  - `@hookwarden/mcp` is not in the fixed group; ships v0.8.4 via transitive patch (bundles the v0.7.3 rule pack inline)

- Updated dependencies
  - hookwarden@0.7.3

## 0.7.2

### Patch Changes

- ## v0.7.2 — Surface references in CLI + JSON output

  v0.7.1 backfilled `references:` on 142 grandfathered rules — 230 cited end to end — but the renderer never read the field, so the citations lived in the YAML and were invisible to anyone running `hookwarden scan`. This release closes that loop.

  ### Text renderer — new `refs ›` block per finding

  After the existing `docs › <provider docs URL>` line, every finding now emits its rule's external citations on a `refs ›` block. The first reference rides on the prefix line; continuations align under it.

  ```
  × critical  apps/api/webhook.js:7:1  stripe/missing-signature-verification  not-verified
    Stripe webhook handler does not appear to verify the signature header...
    fix › pass the raw request body, the Stripe-Signature header, and...
    docs › https://stripe.com/docs/webhooks
    refs › https://www.svix.com/blog/common-failure-modes-for-webhook-signatures/
           https://hookdeck.com/webhooks/guides/webhook-security-vulnerabilities-guide
  ```

  URL references render as OSC-8 hyperlinks (clickable in modern terminals); non-URL references (e.g. `CWE-345 — ...`) render as plain text. `docs ›` and `refs ›` are deliberately distinct roles — `docs ›` is the vendor's canonical security page; `refs ›` is independent evidence (CWE / RFC / Svix / Hookdeck guides) that auditors follow back to a stable external authority.

  ### JSON renderer — new `references[]` field per finding

  `scan.findings[].references: string[]` is now part of the JSON envelope. Always present (empty array when ruleSet is unavailable or the rule has none) so CI consumers can length-check without null guards.

  ```json
  {
    "scan": {
      "findings": [
        {
          "rule_id": "stripe/missing-signature-verification",
          "severity": "critical",
          "state": "not-verified",
          "references": [
            "https://www.svix.com/blog/common-failure-modes-for-webhook-signatures/",
            "https://hookdeck.com/webhooks/guides/webhook-security-vulnerabilities-guide"
          ]
        }
      ]
    }
  }
  ```

  ### Type change

  `RuleDefinition.references: ReadonlyArray<string> | null` is now part of `@hookwarden/engine`'s public type. Existing consumers continue to compile — the field is nullable, not required. The v0.7+ rule pack populates it on every rule; older rule packs (pre-v0.7.1) carried null.

  ### Not changed

  - No new rule classes, no new providers, no rule re-grading
  - SARIF renderer not yet updated — SARIF has its own `references` schema slot which needs structural mapping (deferred to a follow-up)
  - `@hookwarden/mcp` not in the fixed-version group; ships v0.8.3 via transitive patch from the engine/rules bumps (bundles the v0.7.2 rule pack inline)

- Updated dependencies
  - hookwarden@0.7.2

## 0.7.1

### Patch Changes

- ## v0.7.1 — Rule-pack polish

  Two evidence-quality sweeps across all 230 YAML rules. No new rule classes, no behaviour change for findings outside test paths.

  ### References backfilled on 142 grandfathered rules — coverage 38% → 100%

  Every rule now carries ≥1 external citation (CWE / RFC / Svix / Hookdeck / Stripe spec) alongside the existing `provider_docs_url:`. Auditors and reviewers can now follow any finding back to a stable external source without manually cross-referencing the rule class.

  Citation strategy is class-based and stable:

  - **Verification-absent** (`missing-signature-verification`, `unreachable-verification`, `verify-after-side-effect`, `raw-body-misuse`, `express-middleware-ordering`) → Svix + Hookdeck guides
  - **Bypass / timing** (`timing-unsafe-comparison`, `missing-timing-safe-equal`, `wrong-hmac-algorithm`, `empty-secret-bypass`, `test-mode-bypass`) → Coda Hale timing-attack writeup + CWE-208 / RFC 2104 / CWE-521
  - **Replay** (`missing-timestamp-check`, `replay-window-too-permissive`) → Stripe replay-attacks docs + Standardwebhooks spec
  - **Leak** (`secret-in-log-or-error`, `hardcoded-secret-prefix`, `url-secret-in-path`) → CWE-532 / CWE-798 / CWE-598 + OWASP
  - **Error swallowed** (`verification-error-swallowed`) → CWE-391 + OWASP improper-error-handling
  - **Provider-specific quirks** (`header-confusion`, `signature-prefix-not-stripped`, etc.) → Svix + CWE-345

  ### Test-path severity overrides on 219 rules

  Adds `path_severity_overrides:` to every rule not already at `info` severity, downgrading findings inside `**/{test,tests,__tests__,spec,specs}/**` and `**/*.{test,spec}.{js,ts,jsx,tsx,mjs,cjs,py,php}` to `info`. Test fixtures legitimately demonstrate insecure patterns; previously these would surface as `critical` or `high` and contribute to false-positive noise. The 9 info-severity rules are skipped — no further downgrade makes sense.

  Coverage of `path_severity_overrides:` jumps from 2/230 (1%) to 221/230 (96%).

  ### Not changed

  - No new rule classes
  - No `fix:` codegen additions — manual-only coverage remains at 18% (42/230); this is a separate workstream
  - No severity re-grading — the binary critical/high distribution remains; medium/low introduction deferred
  - Engine behaviour unchanged
  - `@hookwarden/mcp` is not in the fixed-version group; it stays at 0.8.1

- Updated dependencies
  - hookwarden@0.7.1

## 0.7.0

### Patch Changes

- Updated dependencies
  - hookwarden@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [c81cc40]
  - hookwarden@0.6.0

## 0.5.5

### Patch Changes

- Updated dependencies [80c46ef]
- Updated dependencies [3217cec]
  - hookwarden@0.5.5

## 0.5.4

### Patch Changes

- Updated dependencies
  - hookwarden@0.5.4

## 0.5.3

### Patch Changes

- Updated dependencies
- Updated dependencies [a2e1946]
  - hookwarden@0.5.3

## 0.5.2

### Patch Changes

- Updated dependencies [4a2201b]
- Updated dependencies [992b3d2]
  - hookwarden@0.5.2

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
  - hookwarden@0.5.1

## 0.5.0

### Patch Changes

- Updated dependencies [66814fc]
  - hookwarden@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [13b7438]
- Updated dependencies
  - hookwarden@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [2496be2]
  - hookwarden@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies [f72331f]
- Updated dependencies [08fb590]
- Updated dependencies [442f0b9]
  - hookwarden@0.3.0

## 0.2.0

### Patch Changes

- hookwarden@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [0a0ff4c]
- Updated dependencies [1fadc62]
  - hookwarden@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies [89746ba]
- Updated dependencies [43379cb]
- Updated dependencies [c7b39d1]
  - hookwarden@0.1.0

## 0.0.1

### Patch Changes

- 7ffb431: Initial v0.0.1 release — defensive name registrations.

  Empty stubs for all 9 OSS package names (1 canonical + 4 scoped + 5 typo
  shims) to claim namespaces on npm before any public mention. Functional
  implementations land in subsequent versions.

- Updated dependencies [7ffb431]
  - hookwarden@0.0.1
