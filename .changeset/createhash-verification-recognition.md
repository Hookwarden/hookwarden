---
"@hookwarden/rules": patch
---

Recognize hand-rolled `createHash`-based webhook verification so it is no longer mis-reported as a critical `missing-signature-verification: not-verified`.

Handlers that verify a signature with an unkeyed `createHash('sha256').update(secret + body)` (plus a comparison) — e.g. n8n's HubSpot and Copper triggers — were flagged as having no verification at all, because recognition keyed only on `createHmac`. These now resolve to `manual-review`: verification is present but its scheme is weak and its raw-body/constant-time correctness is undecided. `createHash` is gated on an accompanying equality comparison and is intentionally kept out of `isManualHmacEntry`, so HMAC timing/timestamp detection and all other providers are unchanged.
