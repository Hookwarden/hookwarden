---
"@hookwarden/engine": patch
"@hookwarden/rules": patch
"hookwarden": patch
---

Add Remix support. Remix `action` route modules under `app/routes/**` receive a Web Fetch API
Request — identical to Next.js App Router — but were undetected, so a real Remix webhook scanned to
0 handlers and silently reported "clean" (a false negative; found scanning documenso, whose Stripe
webhook is `apps/remix/app/routes/api+/stripe.webhook.ts`). New `remixAdapter` detects `action`
exports and derives the route from the remix-flat-routes filename (`api+/stripe.webhook` →
`/api/stripe/webhook`); rules apply to remix via the nextjs equivalence in `ruleAppliesToFramework`
(no per-rule YAML churn). `remix` added to the engine Framework union + the rules `applies_to` enum.
