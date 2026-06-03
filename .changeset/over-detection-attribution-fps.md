---
"@hookwarden/engine": patch
"@hookwarden/rules": patch
"hookwarden": patch
---

Cut real-app false positives from provider over-detection / mis-attribution (found scanning dub):

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
