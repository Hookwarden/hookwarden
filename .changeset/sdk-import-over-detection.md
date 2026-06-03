---
"@hookwarden/engine": patch
"hookwarden": patch
---

Stop flagging non-webhook routes that merely import a provider SDK (found scanning dub:
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
