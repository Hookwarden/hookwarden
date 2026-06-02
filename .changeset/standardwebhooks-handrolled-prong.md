---
"@hookwarden/engine": patch
"@hookwarden/rules": minor
"hookwarden": minor
---

Complete the Standard Webhooks detector with the hand-rolled prong (Clerk CVE-2025-53548) and fix a provider-attribution bug it surfaced.

- **STDWH-01 hand-rolled prong**: a handler that re-implements the Standard Webhooks spec by hand — HMAC-SHA256 over the canonical `{msg_id}.{timestamp}.{body}` string — is now graded three ways. With **no comparison reachable** it is `not-verified` (the Clerk CVE-2025-53548 shape, where the signature is computed but never checked); with only an **undecidable local compare wrapper** (`safeCompare()` / `verifySig()`) it is `manual-review`; with a **recognized constant-time compare** it defers. Covers JS/TS (Babel), Python (tree-sitter), and PHP (tree-sitter source-walk). Plan 16 shipped only the library-import prong, so hand-rolled re-implementations were previously missed.
- **`multi-signature-mishandled`**: a new rule for the `v1,<sig1> v1,<sig2>` rotation list — a manual-HMAC handler with no signature-iteration symbol reachable is `manual-review` (it likely breaks the moment a secret is rotated).
- **Provider-attribution fix**: a correctly-verified hand-rolled handler (`crypto.createHmac` + `crypto.timingSafeEqual`) was mis-attributed to `anthropic-agent-sdk` and graded by the wrong provider's rules. Generic stdlib crypto primitives that some catalog entries list as VAS-01 suppression anchors no longer drive provider attribution; the VAS-01 suppression itself is unchanged.

No `whsec_` hardcoded-secret rule is added — the existing Stripe rule already matches it provider-agnostically. Engine purity preserved.
