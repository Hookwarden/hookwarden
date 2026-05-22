# Phase 3 e2e fixtures

Eight fixture variants reproducing each Phase 3 success criterion when fed through
`hookwarden scan` / `hookwarden inventory`. Intent: correctness proof, not perf
proof — fixtures are intentionally small (5–10 source files total).

| Directory | Purpose | Expected finding |
|-----------|---------|------------------|
| `canonical-stripe-bug/` | Express app with `express.json()` registered globally before the Stripe webhook route — the canonical middleware-ordering bug. | `stripe/missing-signature-verification` at `[critical]` / `[not-verified]` (success criterion #2). |
| `stripe-construct-event-happy-path/` | Correct Stripe handler using `stripe.webhooks.constructEvent` + `express.raw` for the webhook route. | `stripe/library-verified` at `[info]` / `[verified]` (success criterion #3 JS). |
| `python-flask-bug/` | Flask app computing HMAC manually but comparing with plain `==` instead of `hmac.compare_digest`. | `stripe/timing-unsafe-comparison` (or `stripe/missing-signature-verification`) at `[not-verified]`. |
| `python-flask-happy-path/` | Flask app calling `stripe.Webhook.construct_event` correctly. | `stripe/library-verified` at `[info]` / `[verified]` (success criterion #3 Python). |
| `php-vanilla-bug/` | Vanilla PHP handler computing HMAC manually but comparing with `strcmp()` (not constant-time) instead of `hash_equals`. | `stripe/timing-unsafe-comparison` at `[critical]` / `[not-verified]`. Used by the Docker binary smoke harness (T7) to prove the tree-sitter-php WASM loader resolves in compiled-Bun context. |
| `php-laravel-bug/` | Laravel-shaped PHP handler (namespace use + `Route::post` closure + `Request` object) comparing HMAC with `===` strict-equality. | `stripe/timing-unsafe-comparison` at `[critical]` / `[not-verified]`. Used by the Docker binary smoke harness (T8) to prove the PHP parser handles framework-shaped code, not just vanilla top-level scripts. |
| `php-edge-cases/` | Two real-world PHP shapes that exercise tree-sitter-php beyond the vanilla top-level form: `bom-prefixed.php` starts with a UTF-8 BOM (Windows-edited files commonly have one); `namespaced-class.php` puts the handler as a `public function` on a namespaced class. | Both files yield `stripe/timing-unsafe-comparison`. Used by the Docker binary smoke harness (T11). |
| `seeded-secret/__tests__/` | Express handler with a hardcoded `whsec_test_FAKE_DEADBEEF` literal inside the handler body. The path matches `**/__tests__/**` so `path_severity_overrides` downgrades severity to `info`. | `stripe/hardcoded-secret-prefix` at `[info]` (severity downgraded by path) / `[not-verified]` (state unchanged) — success criterion #4 RULES-05. |

## License note

The literal `whsec_test_FAKE_DEADBEEF` in `seeded-secret/__tests__/whsec_test.ts` is a
**deliberately invalid** Stripe-shape webhook signing secret used solely to exercise the
hardcoded-secret-prefix rule. It is NOT a real credential and any defensive scanner that
flags it as a finding is doing its job — that is exactly what hookwarden is supposed to
detect.
