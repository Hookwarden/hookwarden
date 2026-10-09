---
"@hookwarden/rules": minor
"@hookwarden/engine": patch
"hookwarden": patch
---

Add PayPal, Braintree and NMI provider rule packs (24 → 27 providers, 249 → 270 rules).

- **NMI** — hand-rolled HMAC-SHA256 (hex) over `<nonce>.<raw body>` from the `Webhook-Signature: t=<nonce>,s=<sig>` header: missing verification, timing-unsafe comparison, raw-body misuse, wrong algorithm, unreachable verification, plus the cross-cutting ordering / error-swallowing / test-mode / secret-logging rules. NMI shares the `Webhook-Signature` header name with Standard Webhooks; the engine now credits a header claimed by several providers only to the claimant the handler's other evidence points at (else the first declarer), so header-only Standard Webhooks handlers keep their attribution.
- **Braintree** — SDK-verified via `webhookNotification.parse(bt_signature, bt_payload)` (Node, Python, PHP incl. `$gateway->webhookNotification()->parse()`): `library-verified` when the parse call is reachable, `missing-signature-verification` when the payload is decoded without it.
- **PayPal** — SHA256withRSA, not HMAC, and neither the SDK verify call nor the `/v1/notifications/verify-webhook-signature` postback throws on a forged event. A custom predicate reports verified only when the handler also checks the result (`verification_status` === `SUCCESS`, or the verify call as an `if` condition); an unchecked call, local RSA verification, or verification living elsewhere in the file is manual-review; nothing is not-verified.
