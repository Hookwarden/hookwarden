---
"@hookwarden/rules": patch
---

A webhook handler that delegates verification to an opaque imported function — e.g. documenso's
Remix action `return stripeWebhookHandler(request)`, where the import resolves+verifies in another
package the engine can't follow — now resolves to `manual-review` instead of a `not-verified`
critical. Per the 3-state model that's the honest verdict: the verification may live inside the
opaque callee, so it can't be PROVEN unverified. Tightly scoped to the RAW request object passed as
a call argument to an IMPORTED callee; `fn(req.body)` / `req.json()` (parsed/consumed body) stay
not-verified, and local callees the reachability pass already analyzed are unaffected.
