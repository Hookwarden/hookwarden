# @hookwarden/engine

## 0.8.0-beta.2

### Patch Changes

- 8f8c131: Real-app correctness + scan-robustness + terminal-UX fixes (found auditing dub / cal.com / documenso):

  - **engine: `req.text()` / `req.arrayBuffer()` now count as raw-body access.** The raw-body evidence
    detector recognized `express.raw`, `req.body`, `php://input`, etc. but not the Web Fetch API reads
    used by Next.js App Router / Remix / Hono — exactly the pattern Stripe's docs prescribe
    (`const buf = await req.text(); stripe.webhooks.constructEvent(buf, sig, secret)`). Correctly-verified
    App Router webhooks were flagged `stripe/raw-body-misuse` — a false-positive critical on textbook
    code. Now recognized (incl. `.clone()`d request vars like `clonedReq.text()`), without
    over-suppressing genuine misuse (`response.text()` still doesn't count).

  - **`scan` fails loud on an unscannable target.** A nonexistent / unreadable / non-file-or-dir path
    used to walk an empty tree → exit 0 "No findings" — a false all-clear for a CI security gate. It now
    exits 3 with `error: cannot scan '<path>': …`. (`inventory`, a listing command, stays graceful.)
    `/dev/null` and broken symlinks no longer leak an internal `ENOTDIR` baseline path.

  - **`--no-trivia` / `--no-update-notifier` are now accepted.** Both were documented in `--help` and
    consumed by `scan` but missing from the flag allowlist, so they were rejected as unknown flags.

  - **file:line hyperlinks anchor correctly.** Scanning a single file emitted a doubled-basename link
    (`…/x.js/x.js:3:1`); `inventory` resolved links against `process.cwd()` instead of the scan root.
    Both now anchor to the scan directory.

  - **footer tally trims zero tiers.** `Found 2 critical · 0 high · 0 medium · 0 low · 0 info · 0 manual-review`
    → `Found 2 critical`. Only non-zero severities show; `manual-review` shows only when present.

- ade4609: Cut real-app false positives from provider over-detection / mis-attribution (found scanning dub):

  - **Generic HTTP headers no longer drive provider attribution.** Postmark's catalog `signature_header`
    is `authorization` (its Basic-Auth scheme), but `Authorization` is read by nearly every
    authenticated route — so OAuth token endpoints, cron jobs, and admin routes were attributed to
    postmark and flagged as unverified postmark webhooks. A generic-header read (Authorization,
    Content-Type, …) is now recorded provider-agnostically; real postmark webhooks are still attributed
    by their specific signals (`/postmark/*` paths, SDK, `POSTMARK_*` env), and postmark's rules detect
    Basic-Auth via reachable symbols, not this header.

  - **Stripe v2 verify calls recognized.** `stripe.parseThinEvent(...)` (v2 API / thin events) and
    `webhooks.constructEventAsync(...)` (Edge/Workers async API) are now treated as signature
    verification, so correctly-verified v2 webhooks are no longer flagged
    stripe/missing-signature-verification.

  Combined with the `req.text()` raw-body fix, false-positive criticals on the dub codebase dropped
  from 20 to 9 (the remaining 9 are genuine unverified webhook routes plus two non-webhook routes that
  merely import the Stripe SDK — a separate over-detection class tracked for follow-up).

- c7f1046: Add Remix support. Remix `action` route modules under `app/routes/**` receive a Web Fetch API
  Request — identical to Next.js App Router — but were undetected, so a real Remix webhook scanned to
  0 handlers and silently reported "clean" (a false negative; found scanning documenso, whose Stripe
  webhook is `apps/remix/app/routes/api+/stripe.webhook.ts`). New `remixAdapter` detects `action`
  exports and derives the route from the remix-flat-routes filename (`api+/stripe.webhook` →
  `/api/stripe/webhook`); rules apply to remix via the nextjs equivalence in `ruleAppliesToFramework`
  (no per-rule YAML churn). `remix` added to the engine Framework union + the rules `applies_to` enum.
- 729c7a1: Stop flagging non-webhook routes that merely import a provider SDK (found scanning dub:
  `billing/cancel`, `billing/payment-methods`). Next.js App Router admits every `route.ts` POST
  regardless of path, so a route at a non-webhookish path whose only provider signal is `import Stripe`
  (used to call `stripe.subscriptions.update`, not to receive webhooks) was attributed to stripe and
  flagged stripe/missing-signature-verification — a false-positive critical. Such a route is
  statically indistinguishable from a real webhook, so it's now demoted to provider `unknown` (no
  provider rules fire), matching the engine's existing "ambiguous route → unknown → no finding" stance.
  A webhookish path (the canonical `/webhook` bug, whose only stripe signal is also the import) or any
  receiving signal (signature-header read, verify call, raw-body read, webhook secret, conventional
  path) keeps the attribution. Combined with the earlier raw-body / generic-header / parseThinEvent
  fixes, false-positive criticals on the dub codebase dropped from 20 to 7 (the 7 remaining are
  genuine unverified webhook routes).

## 0.8.0-beta.1

### Minor Changes

- 056ba21: Add queue-handler + edge-runtime reachability overlays and the first asymmetric (Ed25519) provider.

  - **REACH-01 — queue-handler reachability**: a handler that enqueues the raw body via bullmq / SQS / inngest / Kafka and has a verifying consumer of that queue reachable now resolves to `manual-review` instead of `not-verified` (the engine can't prove same-payload verification across the queue boundary, so it never claims `verified`). A queue enqueue with no verifying consumer stays `not-verified`.
  - **REACH-02 — edge-runtime detection**: webhook handlers on Cloudflare Workers (`export default { fetch }`), Vercel Edge (`runtime: 'edge'`), and Deno (`Deno.serve`) are now detected (Next.js App Router was already covered), so the HMAC-over-raw-body rules evaluate them instead of missing or mis-flagging. The full rule pack's `applies_to` now includes `cloudflare-workers` / `vercel-edge` / `deno`.
  - **DISCORD-01 — Ed25519 provider**: Discord interactions are the first asymmetric provider (`signature_scheme: ed25519`, verified against the app public key). The rule recognizes `verifyKey` (discord-interactions-js), `nacl.sign.detached.verify` (tweetnacl), `nacl.signing.VerifyKey(...).verify(...)` (PyNaCl), and `sodium_crypto_sign_verify_detached` (PHP) as verified; a Discord handler with no Ed25519 verification is `not-verified`. Discord interaction paths are now detected.

  Engine purity preserved; existing HMAC providers untouched.

- c10427a: v0.8 launch — webhook integrity, from first line to final audit.

  This is the stable v0.8 cut of the CLI + engine + rules cluster. It rolls up the
  v0.8 milestone surface: the n8n agentic-callback ruleset (detecting unverified
  agent/tool webhook sinks, shipped after the Cisco Talos n8n abuse report), the
  Anthropic Agent SDK tool-callback ruleset, and the `compliance_mappings` schema
  (SOC 2 + ISO 27001 + EU AI Act Annex III + NIST AI RMF) surfaced in
  `hookwarden --version --verbose`, with the v1.1 evidence pack carrying the EU AI
  Act Annex III high-risk classification and an embedded offline-verifiable
  signing key.

  The MCP server shipped earlier in the v0.8 cycle and versions independently of
  this fixed cluster, so it is intentionally not part of this changeset.

### Patch Changes

- 1bd1791: Complete the Standard Webhooks detector with the hand-rolled prong (Clerk CVE-2025-53548) and fix a provider-attribution bug it surfaced.

  - **STDWH-01 hand-rolled prong**: a handler that re-implements the Standard Webhooks spec by hand — HMAC-SHA256 over the canonical `{msg_id}.{timestamp}.{body}` string — is now graded three ways. With **no comparison reachable** it is `not-verified` (the Clerk CVE-2025-53548 shape, where the signature is computed but never checked); with only an **undecidable local compare wrapper** (`safeCompare()` / `verifySig()`) it is `manual-review`; with a **recognized constant-time compare** it defers. Covers JS/TS (Babel), Python (tree-sitter), and PHP (tree-sitter source-walk). Plan 16 shipped only the library-import prong, so hand-rolled re-implementations were previously missed.
  - **`multi-signature-mishandled`**: a new rule for the `v1,<sig1> v1,<sig2>` rotation list — a manual-HMAC handler with no signature-iteration symbol reachable is `manual-review` (it likely breaks the moment a secret is rotated).
  - **Provider-attribution fix**: a correctly-verified hand-rolled handler (`crypto.createHmac` + `crypto.timingSafeEqual`) was mis-attributed to `anthropic-agent-sdk` and graded by the wrong provider's rules. Generic stdlib crypto primitives that some catalog entries list as VAS-01 suppression anchors no longer drive provider attribution; the VAS-01 suppression itself is unchanged.

  No `whsec_` hardcoded-secret rule is added — the existing Stripe rule already matches it provider-agnostically. Engine purity preserved.

## 0.8.0-beta.0

### Minor Changes

- Add the n8n agentic-callback ruleset. The engine gains a workflow-JSON adapter that ingests `*.workflow.json` files and n8n community custom-nodes (`package.json#n8n.nodes`, `INodeType`/`IWebhookFunctions` sources), synthesizing handler models from n8n trigger/webhook nodes. A new n8n rule pack detects unverified-body agent/tool sinks (VAS/BYP on `getBodyData()`, `$json`, `items[0].json` reaching agent-tool calls) while staying silent on mitigated, signature-verified shapes. The `hookwarden` CLI now scans n8n projects end-to-end (`scan` surfaces n8n findings and malformed-workflow parse errors).

## 0.7.5

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

## 0.5.5

### Patch Changes

- 80c46ef: Two DX/correctness fixes:

  - **`hookwarden fix <file>`** (a single-file path) now works. It silently reported "0 fixable
    findings" because the file path was used as the base directory for re-parsing the touched
    files, so `path.join()` produced bogus paths and the codegen never ran. Directory scans were
    unaffected.
  - **Engine version is no longer stale.** The footer (`engine vX`) and SARIF `tool.driver.version`
    reported `0.5.0` across the entire 0.5.x line. `packages/engine/src/version.ts` is now generated
    from `package.json` (mirroring `@hookwarden/rules`) with a drift-gate test, so it can't fall out
    of sync again.

- 3217cec: Fix a false positive: `wrong-hmac-algorithm` no longer flags JS/TS handlers that correctly
  use HMAC-SHA256. Node's `crypto.createHmac('sha256', …)` passes the algorithm as a string
  literal (unlike Python's `hashlib.sha256`, a member-access symbol), so the engine never saw
  it — and the rule treated every manual-HMAC JS handler as "algorithm undetermined", emitting
  a spurious `manual-review`. The engine now captures the literal algorithm as a `crypto.<algo>`
  reachable symbol, so SHA-256 is confirmed (no finding) while MD5/SHA-1 are still caught.

## 0.5.4

## 0.5.3

## 0.5.2

### Patch Changes

- 992b3d2: Fix three bugs that prevented the three-state verdict from displaying correctly:

  - **Engine: library-verified handlers now resolve to `verified`.** A handler whose only finding was a passing SDK verification (e.g. `stripe.webhooks.constructEvent`) was pinned to the `manual-review` baseline, so its finding line said `verified` while the inventory column said `[manual-review]`. The handler verdict now trusts the rules' aggregate when any rule fires, and only falls back to `manual-review` when nothing is found.
  - **Rules: `stripe/express-middleware-ordering` no longer fires cross-provider.** The Stripe-namespaced rule matched any Express handler with `express.json()` before the route, emitting a Stripe-branded finding on (e.g.) a GitHub webhook — a false positive. Each provider's own `raw-body-misuse` rule already covers this, so the rule is now scoped to Stripe handlers.
  - **CLI: `hookwarden inventory` no longer leaks a literal `[1m` in the header.** The bold escape was missing its `\x1b`, so color-mode output printed `[1mframework … file:line[0m` as text instead of bolding the header row.

  Exit codes, JSON, and SARIF envelopes are unchanged.

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

## 0.5.0

## 0.4.0

### Minor Changes

- 13b7438: feat(php): PHP language support — v1 third language alongside JS/TS and Python

  hookwarden now scans PHP webhook handlers and produces the same 3-state findings
  (verified / not-verified / manual-review) as JavaScript/TypeScript and Python.

  **Frameworks**: Laravel, Symfony, Slim, and vanilla-PHP single-file handlers.
  Laravel and Slim ship as declarative-routing detection in the engine catalog;
  Symfony attributes (`#[Route]`) ship via a bespoke adapter; vanilla-PHP ships
  as a heuristic adapter (positive signals: `file_get_contents('php://input')`,
  `hash_hmac()`, `$_SERVER['HTTP_*_SIGNATURE']` reads, `getallheaders()`).

  **Providers**: All six v1 providers — Stripe, GitHub, Shopify, Slack, Twilio, Square.
  Catalog gains PHP namespace prefixes (`Stripe\`, `Shopify\`, `Twilio\`, `Square\`)
  and PHP FQN call shapes (`Stripe\Webhook::constructEvent`,
  `Shopify\Utils::validateHmac`, `Twilio\Security\RequestValidator::validate`,
  `Square\Utils\WebhooksHelper::isValidWebhookEventSignature`). GitHub and Slack
  intentionally ship no PHP namespace prefix — both providers' PHP webhook
  verification is overwhelmingly hand-rolled `hash_hmac` + `hash_equals`; the
  language-agnostic rules catch the manual-flow shape.

  **Rule pack PHP additions**: `_helpers-php.ts` shared AST walkers + per-provider
  PHP predicates (`stripe-php-timing-unsafe-comparison`, `github-php-timing-safe-equal`)

  - generic predicate PHP dispatch (`timing-unsafe-comparison`, `missing-signature-verification`,
    `github-timing-safe-equal`, `library-verified-recognition`). 43 v1-provider YAMLs
    get `applies_to` extended with `laravel`, `symfony`, `slim`, `vanilla-php`.
    Express-only rules (`stripe/express-middleware-ordering`,
    `github/missing-timing-safe-equal`) intentionally preserved JS-only.

  **WASM artefact**: `tree-sitter-php.wasm` (`tree-sitter-php@0.24.2`) embedded in
  the compiled binaries via the dual-path WASM loader from Phase 4.2 DC-13.

  **Engine purity preserved (D-01)**: PHP loader lives in the CLI; the engine's
  `parsePhp` receives wasm bytes from the CLI runner and never touches the
  filesystem. The 50K-LOC perf integration test scans the combined JS+Python+PHP
  corpus (~88K LOC total) in 2.4s on developer hardware — substantial headroom
  under the 30s ENGINE-06 gate.

  **Quality bar**: FP-01 measurement against the curated PHP corpus is 0% (0/11
  negative fixtures) at high/critical severity excluding manual-review findings.

  PHP 8.0+ syntax floor. See the [language coverage matrix](docs/rule-coverage.md)
  for the per-rule per-framework breakdown.

- feat: CLI surface expansion + engine OOTB-noise reduction

  Three new CLI flags, one new subcommand, and two engine improvements informed by real-world OSS corpus smoke against 11 production repos containing webhook handlers (Stripe, GitHub, Slack, Shopify, Twilio, Square).

  **New CLI surface:**

  - **`hookwarden explain <rule-id>`** — terminal-side rule documentation lookup. Same renderer that powers in-scan finding messages; useful for offline rule research without re-running a full scan.
  - **`--exclude` / `--include` GLOB flags** — monorepo scoping. `--include` narrows first, `--exclude` removes after. Composes with both `hookwarden scan` and `hookwarden inventory`.
  - **`--provider <stripe|github|shopify|slack|twilio|square>`** — phased-rollout filter for staged adoption. Comma-separated for multiple providers (`--provider stripe,github`); gate CI on one provider at a time as you adopt.
  - **`--include-tests`** flag (+ `scan_tests: true` config + `HOOKWARDEN_SCAN_TESTS=1` env) — opt back in to scanning test/fixture paths after the default-exclusion change below.

  **Engine improvements (corpus-driven):**

  - **`pages/_app.js` / `pages/_document.js` (Next.js JSX-in-`.js`) now parse cleanly.** The Babel `jsx` plugin is enabled for `.js`, `.mjs`, and `.cjs` in addition to the previously-supported `.jsx` and `.tsx`. Plain `.ts` files still parse without `jsx` (preserving angle-bracket type assertions like `<number>(value)` — TypeScript itself requires the explicit `.tsx` extension to enable JSX). Eliminates 2 manual-review parse-errors on `kinngh/shopify-nextjs-prisma-app`.
  - **Test/fixture paths are excluded by default.** Production webhook routes almost never live under `test/`, `tests/`, `__tests__/`, `spec/`, `fixtures/`, `mocks/`, `*.test.{ts,tsx,js,jsx,mjs,cjs}`, `*.spec.{ts,tsx,js,jsx,mjs,cjs}`, `test_*.py`, or `*_test.py`. Their handlers are typically deliberately-broken fixtures that exercise the test harness and would otherwise dominate the findings list. The text-output footer surfaces a `(N test/fixture files auto-excluded; use --include-tests to scan)` hint so users always know what was skipped. Eliminates the `probot/probot` false-positive class (4 critical findings, all in `test/integration/*.test.ts` fixtures).

  **Bug fix:**

  - `runScan`'s `buildProjectModel` call now receives the full `ALL_ADAPTERS` registry; previously a subset was passed, suppressing detection in edge cases.

  Composes with the PHP language-support changeset to ship as v0.4.0.

## 0.3.1

## 0.3.0

## 0.2.0

### Minor Changes

- b32262e: feat(engine, rules): catalog-parameterized predicate architecture (D-90, D-91, D-93)

  ProviderCatalogEntry gains 5 additive readonly fields per D-91:
  hmac_algorithm, signing_input_format, timestamp_header, signature_encoding,
  applicable_rules. Existing fields unchanged — additive-only, no breaking change
  for callers reading provider_catalog[provider].signature_header etc.

  12 duplicated Stripe + GitHub provider-bound predicates collapse onto 6 catalog-
  parameterized factory predicates: missing-signature-verification, timing-unsafe-
  comparison, raw-body-misuse, missing-timestamp-check, wrong-hmac-algorithm,
  unreachable-verification. Existing 14 registered predicate keys preserve byte-
  identical names; existing Stripe + GitHub vitest suites stay green (regression net).

  Custom-predicate slot scaffolded at packages/rules/src/predicates/custom/ —
  actual provider-specific custom predicates (Twilio URL+sorted-params canonical-
  string, etc.) land in subsequent provider plans via a CUSTOM_SIGNING_PREDICATES
  registry that the missing-signature-verification factory dispatches to when
  catalog.signing_input_format === 'custom'.

  RULES_PACK_VERSION now sourced from package.json at module load (no drift).
  Closes drift bug between packages/rules/src/index.ts ("0.0.1") and
  packages/rules/package.json ("0.1.1").

  findings_delta:
  added: 0
  removed: 0
  severity_changes: []
  rationale: 'Refactor-only change. No new rule YAMLs ship; the 14 registered predicate keys preserve byte-identical names and behavior on existing Stripe + GitHub fixtures. The findings_delta:0 claim is verifiable by running the predicate vitest suite (107 → 135 passing tests; 28 new direct factory tests added, zero existing assertions modified) plus the e2e CLI integration suite (354 passing on the canonical happy + bug fixtures).'

- 961b967: feat(rules): Shopify rule pack (RULES-01)

  Catalog gains `shopify` entry with hmac_algorithm: 'sha256', signing_input_format: 'raw_body',
  signature_header: ['x-shopify-hmac-sha256'], signature_encoding: 'base64', timestamp_header: null.
  No new TS predicate code — pure additive use of the 06.1 catalog-parameterized factories.

  7 rule YAMLs ship for Shopify: missing-signature-verification, timing-unsafe-comparison,
  raw-body-misuse, missing-timestamp-check (info), wrong-hmac-algorithm, unreachable-
  verification, library-verified. hardcoded-secret-prefix is intentionally excluded per D-95
  (Shopify webhook secrets have no canonical prefix; `secret_literal_prefix: []` in catalog).
  11 synthetic JS fixtures + 3 Python fixtures cover all detection patterns + positive/negative
  cases per D-97.

  Bootstraps `docs/rule-coverage.md` with the per-provider applicability matrix (stripe + github

  - shopify rows; subsequent provider plans append rows).

  ALL_PREDICATES grows from 14 → 21 keys (7 new shopify-\* entries).

  findings_delta:
  added: 7
  removed: 0
  severity_changes: []
  rationale: 'New shopify/\* rules. Corpus repos containing Shopify webhook handlers will newly emit findings for missing-sig-verif, timing-unsafe, raw-body, wrong-hmac, and unreachable-verif. The 7-rule additive count matches applicable_rules length in PROVIDER_CATALOG.shopify. Verifiable via predicate vitest suite (test/shopify.test.ts) on synthetic fixtures.'

- 0bf95c1: feat(engine, rules): Twilio rule pack (RULES-01) + custom-predicate slot first use (D-92)

  Catalog gains `twilio` entry with hmac_algorithm: 'sha1', signing_input_format: 'custom',
  signature_encoding: 'base64', timestamp_header: null. The 'sha1' value extends the engine's
  hmac_algorithm union from `'sha256' | 'sha512'` to `'sha1' | 'sha256' | 'sha512'` — Twilio
  is the v1 outlier and the only sha1 provider. The union remains intentionally narrow (no
  md5, no sha224/sha384) so wrong-hmac-algorithm.ts derives WRONG_HINTS from a closed set.

  First real use of the D-92 custom-predicate slot:
  `packages/rules/src/predicates/custom/twilio-signing.ts` implements the entry-point
  verification check. The catalog entry sets `signing_input_format: 'custom'` and the
  missing-signature-verification factory dispatches via `CUSTOM_SIGNING_PREDICATES['twilio']`.
  Side-effect registration via static top-level import (no dynamic import; engine purity
  preserved per D-23). The factory's wrong-hmac-algorithm.ts already handles 'sha1' via its
  `ALL_ALGO_HINTS.filter` derivation — no additional branching code needed.

  7 rule YAMLs ship for Twilio: missing-signature-verification, timing-unsafe-comparison,
  raw-body-misuse, missing-timestamp-check (info), wrong-hmac-algorithm (high; sha1 expected),
  unreachable-verification, library-verified. hardcoded-secret-prefix excluded per D-95.

  ALL_PREDICATES grows from 21 → 28 keys (7 new twilio-\* entries).
  docs/rule-coverage.md gains the twilio row noting the custom-predicate path.

  findings_delta:
  added: 7
  removed: 0
  severity_changes: []
  rationale: 'New twilio/\* rules + sha1 hmac_algorithm union extension. Corpus repos containing twilio webhook handlers will newly emit findings for missing-sig-verif, timing-unsafe, raw-body, wrong-hmac, and unreachable-verif. The sha1 union extension is a discrete, reviewed type change — downstream callers that exhaustively switch on hmac_algorithm will surface a compile-time error (desired failure mode).'

- f28136e: feat(rules): Slack rule pack — first non-null timestamp_header (RULES-01)

  Catalog gains `slack` entry with hmac_algorithm: 'sha256', signing_input_format:
  'timestamp_dot_body', signature_header: ['x-slack-signature'], signature_encoding: 'hex',
  timestamp_header: 'x-slack-request-timestamp'. Slack is the FIRST provider in the v1 catalog
  where timestamp_header is non-null — the parameterized missing-timestamp-check factory's
  non-null branch is exercised end-to-end (5-minute tolerance window per Slack docs;
  slack/missing-timestamp-check ships at severity: high, NOT info).

  Slack's canonical-string `'v0:' + ts + ':' + body` IS representable by the parameterized
  `timestamp_dot_body` recipe — no custom predicate needed. Pure additive use of 06.1's locked
  factories.

  7 rule YAMLs ship: missing-signature-verification, timing-unsafe-comparison, raw-body-misuse,
  missing-timestamp-check (high), wrong-hmac-algorithm, unreachable-verification, library-
  verified. hardcoded-secret-prefix excluded per D-95 (Slack signing secrets have no canonical
  prefix; xoxb-/xoxp- API tokens are different and live in Phase 11 leak-scanner scope).

  ALL_PREDICATES grows from 28 → 35 keys (7 new slack-\* entries).
  docs/rule-coverage.md gains the slack row.

  11 JS + 3 Python synthetic fixtures under test/fixtures/slack/. test/slack.test.ts adds
  ~17 it() assertions including explicit Date.now-reachable / not-reachable cases for the
  non-null timestamp_header branch.

  findings_delta:
  added: 7
  removed: 0
  severity_changes: []
  rationale: 'New slack/\* rules. Corpus repos containing Slack webhook handlers will newly emit findings for missing-sig-verif, timing-unsafe, raw-body, wrong-hmac, unreachable-verif, AND missing-timestamp-check (the latter at severity: high — Slack signing requires the 5-minute tolerance per their docs). The 7-rule additive count matches applicable_rules length in PROVIDER_CATALOG.slack.'

- 5c5811f: feat(rules): Square rule pack — first custom_field_tuple recipe (RULES-01)

  Catalog gains `square` entry with hmac_algorithm: 'sha256', signing_input_format:
  'custom_field_tuple' (URL+body), signature_header: ['x-square-hmacsha256-signature'],
  signature_encoding: 'base64', timestamp_header: null. After 06.5, four of five
  signing_input_format recipes are exercised end-to-end (raw_body, timestamp_dot_body,
  custom, custom_field_tuple); only url_plus_sorted_params remains documentation-only.

  6 rule YAMLs ship for Square: missing-signature-verification, timing-unsafe-comparison,
  raw-body-misuse, wrong-hmac-algorithm, unreachable-verification, library-verified.

  - missing-timestamp-check intentionally NOT shipped (Square's signing scheme has no
    timestamp header; replay protection is the application's responsibility — analogous
    to Twilio).
  - hardcoded-secret-prefix intentionally NOT shipped per D-95 verification: Square's
    webhook subscription `signature_key` is a random base64 string with no canonical
    literal prefix. Square's API ACCESS tokens (EAAA..., sq0csp-..., sandbox-sq0atb-...)
    do have prefixes but those are different artifacts handled by GitGuardian/TruffleHog
    (PROJECT.md scope). This DEVIATES from the plan's must_haves first bullet, which
    assumed Square has a canonical prefix; the action-step-2 verification carved the
    honest decision (documented in research/square.md).

  ALL_PREDICATES grows from 35 → 41 keys (6 new square-\* entries; no
  square-missing-timestamp-check key registered since the rule does not ship).
  docs/rule-coverage.md gains the square row.

  11 JS + 3 Python synthetic fixtures under test/fixtures/square/. test/square.test.ts
  adds 14 it() assertions.

  findings_delta:
  added: 6
  removed: 0
  severity_changes: []
  rationale: 'New square/\* rules. Corpus repos containing Square webhook handlers will newly emit findings for missing-sig-verif, timing-unsafe, raw-body, wrong-hmac, and unreachable-verif. The 6-rule additive count matches applicable_rules length in PROVIDER_CATALOG.square. Net Phase 6 delta: 7 (Shopify) + 7 (Twilio) + 7 (Slack) + 6 (Square) + 0 (06.1 refactor) = 27 new rules.'

## 0.1.1

### Patch Changes

- 0a0ff4c: Bundle the Python tree-sitter grammar (WASM) into the CLI's published tarball; remove `tree-sitter-python` as a runtime dependency.

  The `tree-sitter-python` npm package ships both a native binding and a WASM grammar artifact. hookwarden only uses the WASM path (via `web-tree-sitter`), but the native binding ran `node-gyp-build` at install time — failing on platforms without prebuilds (Alpine/musl, locked-down corporate environments) and adding install-time latency for everyone.

  Fix: `packages/cli/scripts/sync-wasm.mjs` copies `tree-sitter-python.wasm` into `packages/cli/wasm/` at install + pack time. The CLI loader reads from the bundled location instead of resolving the npm package at runtime. `tree-sitter-python` moves from `dependencies` → `devDependencies` on both `@hookwarden/engine` and `hookwarden` (CLI).

  Net effect for end users:

  - `npm i hookwarden` no longer triggers a native compile step. Works cleanly on Alpine, locked-down CI, and any environment without a C++ toolchain.
  - Tarball grows from 55 kB → 123 kB (gzipped) — the price of bundled portability.
  - Runtime behavior unchanged. Same WASM, same parser, same tests passing.

- 1fadc62: Fix `stripe/raw-body-misuse` false positive on the canonical Stripe happy-path pattern.

  The engine's `body_as_bytes_or_buffer` evidence signal previously searched the handler's arrow function body for raw-body indicators. But `express.raw({ type: 'application/json' })` is registered as an **inline per-route middleware argument** — _outside_ the arrow body — so the search missed it, even though the middleware was correctly resolved into `middleware_chain`.

  Result: `stripe/raw-body-misuse` fired as a critical finding on every codebase that uses Stripe correctly with the path-scoped `express.raw` pattern. The PI-3 integration test had been written around this — `expect(stdout).toContain("verified")` masked the fact that exit code was 1 and a critical FP was being emitted alongside the verified badge.

  **Fix:** Added `collectRawBodyMiddlewareEvidence` overlay in `packages/engine/src/model/build.ts` that follows the same pattern as the `sdkVerifyEvidence` overlay. When `middleware_chain` contains `express.raw` (qualified call) or `raw` (named import) AND the import source is `express` or `body-parser`, an evidence entry of kind `body_as_bytes_or_buffer` is appended. The `import_source` guard prevents false-negative matches from unrelated `raw` middleware on other routers.

  **Test:** PI-3 strengthened — now asserts exit 0, `stripe/library-verified` present, `stripe/raw-body-misuse` absent, and `counts.active.critical == 0` on the happy-path fixture. Full suite: 234/234 pass.

  Net effect for users: scanning a correct Stripe webhook handler that uses `express.raw` as a per-route middleware no longer emits a critical false positive. The `stripe/library-verified` (info, verified) finding still fires correctly to confirm the handler is verified.

## 0.1.0

### Minor Changes

- 0a15cd1: feat(engine, rules): add provider_docs_url + path_severity_overrides to RuleDefinition

  D-57 RULES-05: per-rule path_severity_overrides (post-emit severity rewrite, no state change).
  D-58 RULES-08: provider_docs_url required field on every rule.
  Engine ships pure-functional applyPathSeverityOverrides helper; rules schema bumps Ajv strict shape.
  Smoke-rule github/missing-timing-safe-equal.yaml updated to satisfy new required field.

- c7b39d1: Phase 4 — CLI distribution surface.

  The CLI is now usable in any CI environment:

  - `--format json` emits a versioned, sorted-keys JSON envelope (CLI-02; D-59)
  - `--format sarif` emits SARIF 2.1.0 conformant against the OASIS schema and uploads cleanly to GitHub Code Scanning (CLI-03 + CLI-11; D-60 + D-76)
  - Exit codes 0/1/2/3/4 with documented precedence 3 > 2 > 4 > 1 > 0 (CLI-04; D-65)
  - `--fail-on` severity threshold; suppressed findings never count (CLI-05; D-66)
  - Inline `// hookwarden-disable-next-line <rule-id>` comments (CLI-06; D-61)
  - `.hookwardenignore` (gitignore syntax) for path-level suppression (CLI-07; D-62)
  - `--diff-only` for CI acceleration (CLI-08; D-72 + D-74)
  - `--baseline write` / auto-read for non-greenfield adoption (CLI-10; D-68 + D-69 + D-70)
  - Bundle-inspection gate now runs on every release tag (CLI-09)
  - `hookwarden.config.yaml` config file with the full schema (D-75)

  Engine schema additive: `ScanMetadata` gains `parse_candidates_count` (D-64). `Finding` gains `suppressed` payload (D-63). Both additive — no breaking changes.

  Standalone binaries via `bun build --compile` (macOS arm64/x64, Linux x64/arm64, Windows x64) are deferred to Phase 4.x (D-73). Trigger to revisit: a measurable repeat-install metric on `npx hookwarden`, or a paying customer requesting an air-gapped install path.

### Patch Changes

- 89746ba: Engine `ScanMetadata` gains `parse_candidates_count: number` (D-64). Additive type bump; co-versioned across engine, rules, and CLI per D-05.
- 43379cb: Engine `Finding` gains optional `suppressed` payload (D-63: `{ source: "inline" | "ignore" | "baseline", pattern?, comment?, baselined_at? }`). Additive type bump; co-versioned across engine, rules, and CLI per D-05. CLI Phase 4 suppression annotator populates non-null values; engine emit sites set `suppressed: null` (or omit, since the field is optional).

## 0.0.1

### Patch Changes

- 7ffb431: Initial v0.0.1 release — defensive name registrations.

  Empty stubs for all 9 OSS package names (1 canonical + 4 scoped + 5 typo
  shims) to claim namespaces on npm before any public mention. Functional
  implementations land in subsequent versions.
