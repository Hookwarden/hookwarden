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
  // Phase 8.3 Plan 16 — Standard Webhooks spec (https://www.standardwebhooks.com).
  // One catalog entry sweeps in every conformant provider — Clerk, Resend, Lob, Mux, Knock,
  // Brex, ChannelTalk, Liveblocks, Sumsub — without per-provider catalog entries (the
  // multiplier claim that justifies the dual-prong detector). svix-style headers
  // (webhook-id / webhook-timestamp / webhook-signature). Custom canonical-string recipe
  // `{msg_id}.{timestamp}.{body}` → signing_input_format: 'custom' + custom-predicate slot
  // at predicates/custom/standardwebhooks-signing.ts (D-92). Library-prong-only in this
  // commit — hand-rolled structural AST detection (Clerk CVE-2025-53548 catch) deferred
  // to a Plan 16b follow-up because cross-language AST matching is net-new design surface
  // with non-trivial false-positive risk.
  standardwebhooks: {
    signature_header: ["webhook-signature"],
    sdk_packages: ["standardwebhooks", "standard-webhooks/php", "StandardWebhooks\\"],
    sdk_verify_calls: [
      "Webhook.verify",
      "verify",
      "StandardWebhooks\\Webhook::verify",
      "Webhook::verify",
    ],
    secret_env_prefix: ["WEBHOOK_SECRET", "STANDARDWEBHOOKS_SECRET", "SVIX_SECRET"],
    secret_literal_prefix: ["whsec_"],
    conventional_paths: [
      "/webhooks",
      "/webhook",
      "/api/webhooks",
      "/api/webhook",
    ],
    hmac_algorithm: "sha256",
    signing_input_format: "custom",
    timestamp_header: "webhook-timestamp",
    signature_encoding: "base64",
    applicable_rules: [
      "library-verified",
      "missing-signature-verification",
      "timing-unsafe-comparison",
      "raw-body-misuse",
      "missing-timestamp-check",
      "wrong-hmac-algorithm",
      "unreachable-verification",
    ],
  },
  // Phase 8.3 Plan 07 — Mailchimp Marketing webhooks. UNUSUAL: Mailchimp's
  // historically-documented default model is URL-secret-in-path (the secret
  // is delivered as a route segment, not in a header). The catalog entry
  // shapes signing_input_format: 'custom' so the missing-signature-verification
  // factory dispatches through CUSTOM_SIGNING_PREDICATES['mailchimp'] at
  // predicates/custom/mailchimp-url-secret.ts. The `hmac_algorithm` /
  // `signature_encoding` values are inert pins to the closest existing union
  // members (sha256 / hex) — Mailchimp's default flow uses no HMAC; future
  // HMAC option lands as additive rules without breaking the catalog shape.
  // signature_header is an empty array because the auth signal is the route,
  // not a header (no signature header to read).
  // [unverified-against-docs] tag recorded in 08.3-07-SUMMARY.md — live
  // mailchimp docs page was not fetched in this session.
  mailchimp: {
    // Pinned to the modern HMAC option's documented header form so the catalog
    // contract (`signature_header.length > 0`) holds. The default URL-secret-in-path
    // model does NOT use this header — the custom predicate short-circuits before
    // any signature_header lookup. The value is here for the future HMAC-option
    // rule path and for header-read evidence on handlers that opted into the modern
    // option. [unverified-against-docs] — re-check the actual header name when docs
    // are reachable.
    signature_header: ["x-mailchimp-webhook-signature"],
    sdk_packages: ["@mailchimp/mailchimp_marketing", "mailchimp_marketing", "DrewM\\MailChimp\\"],
    sdk_verify_calls: ["verifyMailchimpSignature", "verifyWebhookSignature"],
    secret_env_prefix: ["MAILCHIMP_WEBHOOK", "MAILCHIMP_API_KEY", "MAILCHIMP_SIGNING"],
    secret_literal_prefix: [],
    conventional_paths: [
      "/webhooks/mailchimp",
      "/api/webhooks/mailchimp",
      "/mailchimp/webhook",
      "/mc-webhook",
    ],
    hmac_algorithm: "sha256",
    signing_input_format: "custom",
    timestamp_header: null,
    signature_encoding: "hex",
    applicable_rules: [
      "missing-signature-verification",
      "url-secret-in-path",
      "timing-unsafe-comparison",
      "raw-body-misuse",
      "unreachable-verification",
    ],
  },
  // Phase 8.3 Plan 05 — HubSpot v3 webhooks. signing_input_format: 'custom' —
  // canonical-string is `${httpMethod}${requestURI}${rawBody}${timestamp}` per
  // HubSpot v3 docs, base64-encoded HMAC-SHA256 under `X-HubSpot-Signature-v3`.
  // Dispatch through CUSTOM_SIGNING_PREDICATES['hubspot'] at
  // predicates/custom/hubspot-signing.ts (D-92, Twilio analog). The "did the
  // handler attempt to verify at all" question is what the custom predicate
  // answers; the concatenation-order failure mode is the wrong-hmac-algorithm +
  // raw-body-misuse rules' responsibility. `@hubspot/api-client` is the
  // general SDK (not a webhook verifier), so sdk_verify_calls are narrow
  // plausible names.
  hubspot: {
    signature_header: ["x-hubspot-signature-v3"],
    sdk_packages: ["@hubspot/api-client", "hubspot", "hubspot3"],
    sdk_verify_calls: ["verifyHubSpotSignature", "verifyWebhookSignature"],
    secret_env_prefix: ["HUBSPOT_WEBHOOK", "HUBSPOT_CLIENT_SECRET", "HUBSPOT_SIGNING"],
    secret_literal_prefix: [],
    conventional_paths: [
      "/webhooks/hubspot",
      "/api/webhooks/hubspot",
      "/hubspot/webhook",
      "/hubspot/webhooks",
    ],
    hmac_algorithm: "sha256",
    signing_input_format: "custom",
    timestamp_header: "x-hubspot-request-timestamp",
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
  // Phase 8.3 Plan 06 — Auth0 Log Streams webhooks. Clean raw_body / sha256 /
  // base64 fit (closest analog: Shopify, DocuSign). Dedicated `Auth0-Signature`
  // header per pinned default (per Auth0 Log Streams docs — pinned default
  // base64/Auth0-Signature; SUMMARY records doc-verification status). No
  // canonical first-party webhook-verification SDK; Auth0 SDKs ship API
  // clients but not webhook verifiers. sdk_verify_calls are narrow plausible
  // function names users might write (Zendesk/Intercom/Linear/DocuSign pattern).
  auth0: {
    signature_header: ["auth0-signature"],
    sdk_packages: ["auth0", "@auth0/auth0-spa-js", "@auth0/nextjs-auth0"],
    sdk_verify_calls: ["verifyAuth0Signature", "verifyWebhookSignature"],
    secret_env_prefix: ["AUTH0_WEBHOOK", "AUTH0_LOG_STREAMS", "AUTH0_SIGNING"],
    secret_literal_prefix: [],
    conventional_paths: [
      "/webhooks/auth0",
      "/api/webhooks/auth0",
      "/auth0/webhook",
      "/auth0/log-streams",
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
    ],
  },
  // Phase 8.3 Plan 02 — DocuSign Connect webhooks. Clean raw_body / sha256 /
  // base64 fit (closest analog: Shopify). Dedicated `X-DocuSign-Signature-1`
  // header — no cross-provider attribution risk. DocuSign Connect does not
  // ship a first-party webhook-verification SDK; their docs show inline HMAC
  // samples. `sdk_packages` lists the general DocuSign eSign SDK so that
  // codebases that pull it in still surface sdk_import evidence;
  // `sdk_verify_calls` are narrow plausible function names users might write
  // when wrapping verification (Zendesk/Intercom/Linear pattern). No PHP
  // namespace prefix appended — DocuSign PHP detections rely on the
  // language-agnostic hash_hmac + hash_equals shapes already caught by the rules.
  docusign: {
    signature_header: ["x-docusign-signature-1"],
    sdk_packages: ["docusign-esign", "docusign-rest-client", "DocuSign\\eSign\\"],
    sdk_verify_calls: ["verifyDocuSignSignature", "verifyWebhookSignature"],
    secret_env_prefix: ["DOCUSIGN_CONNECT", "DOCUSIGN_WEBHOOK", "DOCUSIGN_HMAC"],
    secret_literal_prefix: [],
    conventional_paths: [
      "/webhooks/docusign",
      "/api/webhooks/docusign",
      "/docusign/webhook",
      "/docusign/webhooks",
      "/docusign/connect",
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
    ],
  },
  // Phase 8.3 Plan 04 — Linear webhooks. Clean raw_body / sha256 / hex fit
  // (analog: GitHub or Intercom minus the shared header). Linear sends a
  // dedicated `Linear-Signature` header — no cross-provider attribution risk.
  // No canonical first-party webhook SDK (`@linear/sdk` is the general
  // GraphQL/REST SDK, not a webhook verifier); sdk_verify_calls are narrow
  // plausible function names users might write. No PHP namespace prefix
  // appended; Linear PHP detections rely on the language-agnostic hash_hmac
  // + hash_equals shapes already caught by the rules.
  linear: {
    signature_header: ["linear-signature"],
    sdk_packages: ["@linear/sdk", "linear-sdk"],
    sdk_verify_calls: ["verifyLinearSignature", "verifyWebhookSignature"],
    secret_env_prefix: ["LINEAR_WEBHOOK", "LINEAR_SIGNING", "LINEAR_SIGNING_SECRET"],
    secret_literal_prefix: [],
    conventional_paths: [
      "/webhooks/linear",
      "/api/webhooks/linear",
      "/linear/webhook",
      "/linear/webhooks",
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
    ],
  },
  // Phase 8.3 Plan 03 — Intercom webhooks. Same signing scheme as GitHub legacy
  // (raw_body, sha256, hex, X-Hub-Signature). Intercom literally re-uses GitHub's
  // header name — the predicate factory pattern is provider-agnostic so no shared
  // logic with GitHub is needed beyond shared catalog data. Modern Intercom is
  // sha256; legacy sha1 form surfaces via wrong-hmac-algorithm. No canonical
  // first-party webhook SDK — `intercom-client` is the general API SDK;
  // sdk_verify_calls are narrow plausible function names (same pattern as Zendesk).
  // No PHP namespace prefix appended: Intercom PHP detections rely on
  // language-agnostic hash_hmac + hash_equals shapes already caught by the rules.
  intercom: {
    signature_header: ["x-hub-signature"],
    sdk_packages: ["intercom-client", "intercom-node"],
    // No canonical webhook verifier; narrow function names users might write
    // when wrapping Intercom verification. Kept narrow to avoid false-positive
    // library-verified signals on unrelated `verify()` calls.
    sdk_verify_calls: ["verifyIntercomSignature", "verifyWebhookSignature"],
    secret_env_prefix: ["INTERCOM_WEBHOOK", "INTERCOM_CLIENT_SECRET", "INTERCOM_SIGNING"],
    secret_literal_prefix: [],
    conventional_paths: [
      "/webhooks/intercom",
      "/api/webhooks/intercom",
      "/intercom/webhook",
      "/intercom/webhooks",
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
