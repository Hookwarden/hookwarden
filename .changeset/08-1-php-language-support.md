---
"@hookwarden/engine": minor
"@hookwarden/rules": minor
"@hookwarden/github-action": minor
"hookwarden": minor
---

feat(php): PHP language support — v1 third language alongside JS/TS and Python

hookwarden now scans PHP webhook handlers and produces the same 3-state findings
(verified / not-verified / manual-review) as JavaScript/TypeScript and Python.

**Frameworks**: Laravel, Symfony, Slim, and vanilla-PHP single-file handlers.
Laravel and Slim ship as declarative-routing detection in the engine catalog;
Symfony attributes (`#[Route]`) ship via a bespoke adapter; vanilla-PHP ships
as a heuristic adapter (positive signals: `file_get_contents('php://input')`,
`hash_hmac()`, `$_SERVER['HTTP_*_SIGNATURE']` reads, `getallheaders()`).

**Providers**: All six v1 providers — Stripe, GitHub, Shopify, Slack, Twilio, Square.
Catalog gains PHP namespace prefixes (`Stripe\`, `Shopify\`, `Twilio\`, `Square\`)
and PHP FQN call shapes (`Stripe\Webhook::constructEvent`,
`Shopify\Utils::validateHmac`, `Twilio\Security\RequestValidator::validate`,
`Square\Utils\WebhooksHelper::isValidWebhookEventSignature`). GitHub and Slack
intentionally ship no PHP namespace prefix — both providers' PHP webhook
verification is overwhelmingly hand-rolled `hash_hmac` + `hash_equals`; the
language-agnostic rules catch the manual-flow shape.

**Rule pack PHP additions**: `_helpers-php.ts` shared AST walkers + per-provider
PHP predicates (`stripe-php-timing-unsafe-comparison`, `github-php-timing-safe-equal`)
+ generic predicate PHP dispatch (`timing-unsafe-comparison`, `missing-signature-verification`,
`github-timing-safe-equal`, `library-verified-recognition`). 43 v1-provider YAMLs
get `applies_to` extended with `laravel`, `symfony`, `slim`, `vanilla-php`.
Express-only rules (`stripe/express-middleware-ordering`,
`github/missing-timing-safe-equal`) intentionally preserved JS-only.

**WASM artefact**: `tree-sitter-php.wasm` (`tree-sitter-php@0.24.2`) embedded in
the compiled binaries via the dual-path WASM loader from Phase 4.2 DC-13.

**Engine purity preserved (D-01)**: PHP loader lives in the CLI; the engine's
`parsePhp` receives wasm bytes from the CLI runner and never touches the
filesystem. The 50K-LOC perf integration test scans the combined JS+Python+PHP
corpus (~88K LOC total) in 2.4s on developer hardware — substantial headroom
under the 30s ENGINE-06 gate.

**Quality bar**: FP-01 measurement against the curated PHP corpus is 0% (0/11
negative fixtures) at high/critical severity excluding manual-review findings.

PHP 8.0+ syntax floor. See the [language coverage matrix](docs/rule-coverage.md)
for the per-rule per-framework breakdown.
