# hookwarden rule coverage matrix

Per-provider applicability matrix per Phase 6 D-94. Each cell indicates whether the listed
detection rule ships in the current rule pack. Rules NOT listed are intentionally omitted
per D-95 (no canonical secret prefix for hardcoded-secret-prefix) or per the per-provider
research note (no Python SDK; framework-specific FP risk; etc.).

| Provider | missing-sig-verif | timing-unsafe | raw-body | missing-timestamp | wrong-hmac | unreachable-verif | hardcoded-secret-prefix | library-verified | Custom predicate? |
|---|---|---|---|---|---|---|---|---|---|
| stripe | YES | YES | YES | YES | YES | YES | YES (`whsec_`) | YES | No |
| github | YES | YES | YES | YES | YES | YES | YES (`ghs_`, `github_pat_`) | YES | No |
| shopify | YES | YES | YES | YES (info) | YES | YES | NO (D-95 — no canonical prefix) | YES | No |
| twilio | YES | YES | YES | YES (info) | YES | YES | NO (D-95 — no canonical prefix) | YES | YES (`predicates/custom/twilio-signing.ts`; URL+sorted-params canonical-string + HMAC-SHA1) |
| slack | YES | YES | YES | YES (high) | YES | YES | NO (D-95 — no canonical prefix) | YES | No (parameterized `timestamp_dot_body` recipe) |
| square | YES | YES | YES | NO (no timestamp in scheme) | YES | YES | NO (D-95 — webhook signature keys have no canonical prefix) | YES | No (parameterized `custom_field_tuple` recipe) |

## Language coverage

| Language | Frameworks |
|---|---|
| JavaScript / TypeScript | Express · Hono · Fastify · Next.js |
| Python | Flask · FastAPI · Django |
| **PHP (Phase 8.1)** | Laravel · Symfony · Slim · vanilla-PHP single-file handlers |

PHP support ships in v0.4.0. All rules in the matrix above apply across PHP frameworks
except: `stripe/express-middleware-ordering` (Express-only middleware concern) and
`github/missing-timing-safe-equal` (catches the `crypto.timingSafeEqual` JS-specific
pattern — PHP's `hash_equals` is handled by the cross-language
`github-timing-unsafe-comparison` predicate via PHP dispatch).

### PHP SDK detection

| Provider | PHP namespace prefix | PHP verify FQN |
|---|---|---|
| stripe | `Stripe\` | `Stripe\Webhook::constructEvent`, `Stripe\WebhookSignature::verifyHeader` |
| github | _(none — no canonical PHP webhook SDK)_ | _(none — manual `hash_hmac` + `hash_equals` is the canonical path)_ |
| shopify | `Shopify\` | `Shopify\Utils::validateHmac`, `Shopify\Webhooks\Validator::validate` |
| twilio | `Twilio\` | `Twilio\Security\RequestValidator::validate` (instance method recognised via the namespace-imported + `->validate(...)` overlay) |
| square | `Square\` | `Square\Utils\WebhooksHelper::isValidWebhookEventSignature` |
| slack | _(none — no canonical PHP webhook SDK)_ | _(none — manual `hash_hmac` + `hash_equals` against `v0:${ts}:${body}` is the canonical path)_ |

PHP 8.0+ syntax floor.
