// D-33 provider evidence catalog. Single source of truth across engine routing, rule matchers,
// and Phase 11 leak-scanner (which reuses secret_literal_prefix). Adding a provider = minor bump
// of @hookwarden/rules; engine release not required (the catalog is data, not engine code).
//
// PHP entry convention (Phase 8.1):
//   - `sdk_packages` holds BOTH JS package names (e.g. "stripe") AND PHP namespace prefixes
//     (e.g. "Stripe\\" — note trailing backslash). The engine matches PHP imports via
//     startsWith() so namespace prefixes catch every nested `use Stripe\Webhook;` etc.
//     The doubled backslash here is the TypeScript-source escape; at runtime each entry is
//     the literal string `Stripe\` (one backslash).
//   - `sdk_verify_calls` holds BOTH JS/Python dotted forms AND PHP FQN call shapes (e.g.
//     "Stripe\\Webhook::constructEvent"). The engine PHP overlay matches via exact-text
//     equality against `scoped_call_expression` and `member_call_expression` call sites.

import type { ProviderCatalog } from "@hookwarden/engine";

export const PROVIDER_CATALOG: ProviderCatalog = {
  stripe: {
    signature_header: ["stripe-signature"],
    sdk_packages: ["stripe", "@stripe/stripe-js", "Stripe\\"],
    sdk_verify_calls: [
      "webhooks.constructEvent",
      "Webhook.constructEvent",
      "Webhook.construct_event",
      "Stripe\\Webhook::constructEvent",
      "Webhook::constructEvent",
      "Stripe\\WebhookSignature::verifyHeader",
      "WebhookSignature::verifyHeader",
    ],
    secret_env_prefix: ["STRIPE_WEBHOOK", "STRIPE_SIGNING"],
    secret_literal_prefix: ["whsec_"],
    conventional_paths: [
      "/webhooks/stripe",
      "/api/webhooks/stripe",
      "/stripe/webhook",
      "/stripe/webhooks",
    ],
    hmac_algorithm: "sha256",
    signing_input_format: "raw_body",
    timestamp_header: null,
    signature_encoding: "hex",
    applicable_rules: [
      "missing-signature-verification",
      "timing-unsafe-comparison",
      "raw-body-misuse",
      "missing-timestamp-check",
      "wrong-hmac-algorithm",
      "unreachable-verification",
      "hardcoded-secret-prefix",
      "library-verified",
      "express-middleware-ordering",
    ],
  },
  github: {
    signature_header: ["x-hub-signature-256", "x-hub-signature"],
    // GitHub has no canonical PHP webhook SDK (knplabs/github-api ships no webhook verifier).
    // PHP detections rely on language-agnostic hash_hmac + hash_equals shapes caught by
    // the github-timing-safe-equal rule (Plan 08). No PHP namespace prefix appended here.
    sdk_packages: ["@octokit/webhooks", "@octokit/webhooks-methods"],
    sdk_verify_calls: ["verify", "verifyRequest"],
    secret_env_prefix: ["GITHUB_WEBHOOK", "GH_WEBHOOK"],
    secret_literal_prefix: ["ghs_", "github_pat_"],
    conventional_paths: [
      "/webhooks/github",
      "/api/webhooks/github",
      "/github/webhook",
      "/github/webhooks",
    ],
    hmac_algorithm: "sha256",
    signing_input_format: "raw_body",
    timestamp_header: null,
    signature_encoding: "hex",
    applicable_rules: [
      "missing-signature-verification",
      "timing-unsafe-comparison",
      "raw-body-misuse",
      "missing-timestamp-check",
      "missing-timing-safe-equal",
      "wrong-hmac-algorithm",
      "unreachable-verification",
      "hardcoded-secret-prefix",
      "library-verified",
    ],
  },
  shopify: {
    signature_header: ["x-shopify-hmac-sha256"],
    sdk_packages: ["@shopify/shopify-api", "@shopify/shopify-app-express", "Shopify\\"],
    sdk_verify_calls: [
      "verifyHmac",
      "webhookRegistry.process",
      "shopify.webhooks.validate",
      "verify",
      "Shopify\\Utils::validateHmac",
      "Utils::validateHmac",
      "Shopify\\Webhooks\\Validator::validate",
      "Webhooks\\Validator::validate",
    ],
    secret_env_prefix: ["SHOPIFY_WEBHOOK", "SHOPIFY_API_SECRET", "SHOPIFY_SIGNING"],
    secret_literal_prefix: [],
    conventional_paths: [
      "/webhooks/shopify",
      "/api/webhooks/shopify",
      "/shopify/webhook",
      "/shopify/webhooks",
      "/webhooks/orders/create",
      "/webhooks/products/update",
    ],
    hmac_algorithm: "sha256",
    signing_input_format: "raw_body",
    timestamp_header: null,
    signature_encoding: "base64",
    applicable_rules: [
      "missing-signature-verification",
      "timing-unsafe-comparison",
      "raw-body-misuse",
      "missing-timestamp-check",
      "wrong-hmac-algorithm",
      "unreachable-verification",
      "library-verified",
    ],
  },
  slack: {
    signature_header: ["x-slack-signature"],
    // Slack PHP webhook verification is overwhelmingly done by hand (raw hash_hmac +
    // hash_equals against the v0 signing scheme). slack-php/slack-block-kit and similar
    // packages don't ship a webhook verifier. No PHP namespace prefix appended; manual
    // detection is caught by the timing-unsafe-comparison rule (Plan 08).
    sdk_packages: ["@slack/bolt", "@slack/events-api", "@slack/webhook"],
    sdk_verify_calls: [
      "verifyRequestSignature",
      "isValidSlackRequest",
      "SignatureVerification",
      "verify",
      "is_valid_request",
    ],
    secret_env_prefix: ["SLACK_SIGNING", "SLACK_WEBHOOK"],
    secret_literal_prefix: [],
    conventional_paths: [
      "/webhooks/slack",
      "/api/webhooks/slack",
      "/slack/events",
      "/slack/commands",
      "/slack/interactivity",
      "/slack/options",
    ],
    hmac_algorithm: "sha256",
    signing_input_format: "timestamp_dot_body",
    timestamp_header: "x-slack-request-timestamp",
    signature_encoding: "hex",
    applicable_rules: [
      "missing-signature-verification",
      "timing-unsafe-comparison",
      "raw-body-misuse",
      "missing-timestamp-check",
      "wrong-hmac-algorithm",
      "unreachable-verification",
      "library-verified",
    ],
  },
  square: {
    signature_header: ["x-square-hmacsha256-signature"],
    sdk_packages: ["square", "squareup", "Square\\"],
    sdk_verify_calls: [
      "WebhooksHelper.verifySignature",
      "verifySignature",
      "WebhooksHelper.isValidWebhookEventSignature",
      "isValidWebhookEventSignature",
      "WebhooksHelper.is_valid_webhook_event_signature",
      "is_valid_webhook_event_signature",
      "Square\\Utils\\WebhooksHelper::isValidWebhookEventSignature",
      "WebhooksHelper::isValidWebhookEventSignature",
    ],
    secret_env_prefix: ["SQUARE_WEBHOOK", "SQUARE_SIGNATURE_KEY"],
    secret_literal_prefix: [],
    conventional_paths: [
      "/webhooks/square",
      "/api/webhooks/square",
      "/square/webhook",
      "/square/webhooks",
    ],
    hmac_algorithm: "sha256",
    signing_input_format: "custom_field_tuple",
    timestamp_header: null,
    signature_encoding: "base64",
    applicable_rules: [
      "missing-signature-verification",
      "timing-unsafe-comparison",
      "raw-body-misuse",
      "wrong-hmac-algorithm",
      "unreachable-verification",
      "library-verified",
    ],
  },
  twilio: {
    signature_header: ["x-twilio-signature"],
    sdk_packages: ["twilio", "Twilio\\"],
    sdk_verify_calls: [
      "validateRequest",
      "RequestValidator.validate",
      "validate",
      "Twilio\\Security\\RequestValidator::validate",
      "Security\\RequestValidator::validate",
      "RequestValidator::validate",
    ],
    secret_env_prefix: ["TWILIO_AUTH", "TWILIO_SIGNING"],
    secret_literal_prefix: [],
    conventional_paths: [
      "/webhooks/twilio",
      "/api/webhooks/twilio",
      "/twilio/webhook",
      "/twilio/voice",
      "/twilio/sms",
      "/twilio/messaging",
    ],
    hmac_algorithm: "sha1",
    signing_input_format: "custom",
    timestamp_header: null,
    signature_encoding: "base64",
    applicable_rules: [
      "missing-signature-verification",
      "timing-unsafe-comparison",
      "raw-body-misuse",
      "missing-timestamp-check",
      "wrong-hmac-algorithm",
      "unreachable-verification",
      "library-verified",
    ],
  },
  // Phase 8.3 Plan 01 — Zendesk Connect webhooks. Same signing scheme as Slack
  // (timestamp_dot_body, sha256, base64 — `${timestamp}${rawBody}` HMAC). No canonical
  // first-party webhook SDK; Zendesk docs ship inline HMAC samples. The `sdk_packages`
  // entries below are Zendesk's general API SDKs (NOT webhook-specific) — they satisfy
  // the catalog-shape contract and let library-import detection at least fire on
  // codebases that pull in the API SDK. Per Phase 6b research clean-schema fit, no
  // catalog branch needed.
  zendesk: {
    signature_header: ["x-zendesk-webhook-signature"],
    sdk_packages: ["node-zendesk", "zenpy", "Zendesk\\API\\"],
    // No canonical webhook verifier; these are plausible function names users might write
    // when wrapping verification. They are NOT exported by the listed SDKs — kept narrow
    // to avoid false-positive library-verified signals on unrelated `verify()` calls.
    sdk_verify_calls: ["verifyZendeskSignature", "verifyWebhookSignature"],
    secret_env_prefix: ["ZENDESK_WEBHOOK", "ZENDESK_SIGNING"],
    secret_literal_prefix: [],
    conventional_paths: [
      "/webhooks/zendesk",
      "/api/webhooks/zendesk",
      "/zendesk/webhook",
      "/zendesk/webhooks",
    ],
    hmac_algorithm: "sha256",
    signing_input_format: "timestamp_dot_body",
    timestamp_header: "x-zendesk-webhook-signature-timestamp",
    signature_encoding: "base64",
    applicable_rules: [
      "missing-signature-verification",
      "timing-unsafe-comparison",
      "raw-body-misuse",
      "missing-timestamp-check",
      "wrong-hmac-algorithm",
      "unreachable-verification",
    ],
  },
};
