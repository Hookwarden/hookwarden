---
"@hookwarden/rules": minor
"hookwarden": patch
---

Add PayPal, Braintree and NMI provider rule packs (24 → 27 providers, 249 → 270 rules).

- **NMI** — hand-rolled HMAC-SHA256 (hex) over `<nonce>.<raw body>` from the `Webhook-Signature: t=<nonce>,s=<sig>` header: missing verification, timing-unsafe comparison, raw-body misuse, wrong algorithm, unreachable verification, plus the cross-cutting ordering / error-swallowing / test-mode / secret-logging rules. NMI shares the `Webhook-Signature` header name with Standard Webhooks, so attribution also needs an NMI path, `NMI_*` env var or NMI host.
- **Braintree** — SDK-verified via `webhookNotification.parse(bt_signature, bt_payload)` (Node, Python, PHP): `library-verified` when the parse call is reachable, `missing-signature-verification` when the payload is decoded without it.
- **PayPal** — SHA256withRSA, not HMAC. A custom predicate treats the SDK verify call or a postback to `/v1/notifications/verify-webhook-signature` as verified, local RSA verification as manual-review, and anything else as not-verified.
