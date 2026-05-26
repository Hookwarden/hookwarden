---
"@hookwarden/engine": patch
"@hookwarden/rules": patch
"hookwarden": patch
---

Fix three bugs that prevented the three-state verdict from displaying correctly:

- **Engine: library-verified handlers now resolve to `verified`.** A handler whose only finding was a passing SDK verification (e.g. `stripe.webhooks.constructEvent`) was pinned to the `manual-review` baseline, so its finding line said `verified` while the inventory column said `[manual-review]`. The handler verdict now trusts the rules' aggregate when any rule fires, and only falls back to `manual-review` when nothing is found.
- **Rules: `stripe/express-middleware-ordering` no longer fires cross-provider.** The Stripe-namespaced rule matched any Express handler with `express.json()` before the route, emitting a Stripe-branded finding on (e.g.) a GitHub webhook — a false positive. Each provider's own `raw-body-misuse` rule already covers this, so the rule is now scoped to Stripe handlers.
- **CLI: `hookwarden inventory` no longer leaks a literal `[1m` in the header.** The bold escape was missing its `\x1b`, so color-mode output printed `[1mframework … file:line[0m` as text instead of bolding the header row.

Exit codes, JSON, and SARIF envelopes are unchanged.
