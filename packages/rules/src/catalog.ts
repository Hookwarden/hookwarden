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

// v0.7 Rule Depth (VAS-01) shared sink-call lists. These patterns are
// cross-provider — a DB write is a side effect regardless of which webhook
// fired it. Each provider catalog entry spreads SHARED_VAS_SINKS to inherit
// the same baseline + adds its own `provider_api_hosts` to exclude calls to
// its own API from the outbound-HTTP check (e.g. Stripe handlers calling
// api.stripe.com shouldn't trigger verify-after-side-effect on the HTTP rule).
//
// Catalog wildcard matching is the planner's job — for v0.7.0 the engine's
// qualifiedCallName resolves dotted call chains literally; nested member
// access shapes like `prisma.user.create` and `prisma.event.create` need
// explicit enumeration. Common shapes are listed below; Plan 14 follow-ups
// can extend per real-corpus findings.
const SHARED_VAS_SINKS = {
  db_sink_calls: [
    "prisma.user.create",
    "prisma.user.update",
    "prisma.user.delete",
    "prisma.event.create",
    "prisma.event.update",
    "knex.insert",
    "knex.update",
    "knex.delete",
    "db.query",
    "pool.query",
    "client.query",
    "drizzle.insert",
    "drizzle.update",
    "drizzle.delete",
  ] as const,
  http_sink_calls: [
    "fetch",
    "axios.post",
    "axios.put",
    "axios.delete",
    "axios.patch",
    "got.post",
    "got.put",
    "got.delete",
  ] as const,
  event_sink_calls: [
    "emitter.emit",
    "eventEmitter.emit",
    "sqs.send",
    "sns.publish",
    "kafka.send",
    "pubsub.publish",
  ] as const,
  notification_sink_calls: [
    "nodemailer.sendMail",
    "transporter.sendMail",
    "twilio.messages.create",
    "sendgrid.send",
    "mail.send",
  ] as const,
};

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
      "verify-after-side-effect",
      "verification-error-swallowed",
      "test-mode-bypass",
      "secret-in-log-or-error",
      "replay-window-too-permissive",
    ],
    // v0.7 Rule Depth (VAS-01) — shared sink lists spread from SHARED_VAS_SINKS.
    ...SHARED_VAS_SINKS,
    replay_tolerance_max_seconds: 300,
    provider_api_hosts: ["api.stripe.com"],
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
      "verify-after-side-effect",
      "verification-error-swallowed",
      "test-mode-bypass",
      "secret-in-log-or-error",
    ],
    // v0.7 Rule Depth (VAS-01)
    ...SHARED_VAS_SINKS,
    provider_api_hosts: ["api.github.com"],
  },
  // Phase 24 (AGENT-01) — n8n agentic-callback ruleset. The catalog entry feeds
  // two surfaces:
  //   (1) detector #1 (`n8n/webhook-trigger-no-authentication`) fires on the
  //       JSON-workflow synthetic handler via the `n8n-trigger-no-auth` predicate,
  //       which reads `n8n_node_param` evidence — it does NOT consult these fields.
  //   (2) detector #2 + the 6 baseline rules run against TS custom-node handlers
  //       tagged `provider:n8n` (Plan 24-03). Those reuse the v0.7 VAS-01 /
  //       side-effect-classifier + the per-provider baseline factories, which DO
  //       read sdk_verify_calls / sink lists / secret_literal_prefix below.
  //
  // n8n has no first-party webhook-verification SDK — a custom node verifies the
  // request in code via `IWebhookFunctions.getHeaderData()` + crypto.timingSafeEqual,
  // or an HMAC over the raw body. `sdk_verify_calls` therefore lists the n8n
  // header-access + constant-time-compare shapes that count as verification (clearing
  // detector #2 on the mitigated handler — SC#2). The agent/tool/LLM call names live
  // in the sink lists so the side-effect classifier treats "agent invoked on the
  // unverified body before any header check" as a T1 side-effect-before-verify.
  n8n: {
    signature_header: ["x-n8n-signature", "x-webhook-token"],
    sdk_packages: ["n8n-workflow", "n8n-core"],
    sdk_verify_calls: ["getHeaderData", "timingSafeEqual", "crypto.timingSafeEqual"],
    secret_env_prefix: ["N8N_WEBHOOK", "N8N_SIGNING", "WEBHOOK_TOKEN"],
    secret_literal_prefix: ["n8n_api_"],
    conventional_paths: ["/webhooks/n8n"], // namespaced (24-04 fix): bare "/webhook" collided with every provider route via substring match; n8n is attributed by SDK/import + workflow-JSON sniff, not path
    hmac_algorithm: "sha256",
    signing_input_format: "raw_body",
    timestamp_header: null,
    signature_encoding: "hex",
    applicable_rules: [
      "webhook-trigger-no-authentication",
      "agent-tool-acts-on-unverified-payload",
      "missing-signature-verification",
      "missing-timestamp-check",
      "missing-timing-safe-equal",
      "raw-body-misuse",
      "hardcoded-secret-prefix",
      "secret-in-log-or-error",
    ],
    // v0.7 Rule Depth (VAS-01) shared sinks (DB / HTTP / event / notification) PLUS
    // the n8n agentic sinks: an agent/tool/LLM invocation on the unverified webhook
    // body is exactly the T1 side effect detector #2 keys on (RESEARCH OQ4).
    ...SHARED_VAS_SINKS,
    http_sink_calls: [
      ...SHARED_VAS_SINKS.http_sink_calls,
      "chain.invoke",
      "agent.invoke",
      "agent.call",
      "executor.invoke",
      "AgentExecutor.invoke",
      "tool.invoke",
      "tool.call",
      "llm.invoke",
      "llm.call",
      "openai.chat.completions.create",
      "anthropic.messages.create",
    ],
    // n8n is self-hosted; there is no first-party API host to exclude from the
    // outbound-side-effect check.
    provider_api_hosts: [],
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
      "verify-after-side-effect",
      "verification-error-swallowed",
      "test-mode-bypass",
      "secret-in-log-or-error",
      "replay-window-too-permissive",
    ],
    // v0.7 Rule Depth (VAS-01)
    ...SHARED_VAS_SINKS,
    replay_tolerance_max_seconds: 300,
    provider_api_hosts: ["myshopify.com"],
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
      "verify-after-side-effect",
      "verification-error-swallowed",
      "test-mode-bypass",
      "secret-in-log-or-error",
      "replay-window-too-permissive",
    ],
    // v0.7 Rule Depth (VAS-01)
    ...SHARED_VAS_SINKS,
    replay_tolerance_max_seconds: 300,
    provider_api_hosts: ["slack.com", "api.slack.com"],
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
      "verify-after-side-effect",
      "verification-error-swallowed",
      "test-mode-bypass",
      "secret-in-log-or-error",
    ],
    // v0.7 Rule Depth (VAS-01)
    ...SHARED_VAS_SINKS,
    provider_api_hosts: ["connect.squareup.com"],
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
      "verify-after-side-effect",
      "verification-error-swallowed",
      "test-mode-bypass",
      "secret-in-log-or-error",
    ],
    // v0.7 Rule Depth (VAS-01)
    ...SHARED_VAS_SINKS,
    provider_api_hosts: ["api.twilio.com"],
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
    // Standard Webhooks has no canonical receiving URL — receivers configure their own endpoint
    // per integration. Provider attribution relies on the `webhook-signature` header + SDK
    // package match. Generic paths like `/webhook` belong to no specific provider.
    conventional_paths: [],
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
      "verify-after-side-effect",
      "verification-error-swallowed",
      "test-mode-bypass",
      "secret-in-log-or-error",
      "replay-window-too-permissive",
    ],
    // v0.7 Rule Depth (VAS-01)
    ...SHARED_VAS_SINKS,
    replay_tolerance_max_seconds: 300,
    provider_api_hosts: [],
  },
  // Phase 8.3 Plan 08 — Postmark inbound/outbound webhooks. UNUSUAL: Postmark's
  // default authentication model is HTTP Basic Auth + IP allowlist, NOT HMAC.
  // The catalog entry shapes signing_input_format: 'custom' so the
  // missing-signature-verification factory dispatches through
  // CUSTOM_SIGNING_PREDICATES['postmark'] at predicates/custom/postmark-signing.ts.
  // signature_header is repurposed: `authorization` is the Basic Auth header
  // the handler must read to authenticate. hmac_algorithm/signature_encoding
  // are inert pins to closest existing union members (sha256/hex) — Postmark's
  // default flow uses no HMAC. Future per-server HMAC option (opt-in, rare)
  // lands as additive rules without breaking the catalog shape.
  postmark: {
    signature_header: ["authorization"],
    sdk_packages: ["postmark", "postmarker", "Postmark\\"],
    sdk_verify_calls: ["verifyPostmarkAuth", "verifyWebhookAuth"],
    secret_env_prefix: ["POSTMARK_WEBHOOK", "POSTMARK_BASIC_AUTH", "POSTMARK_HTTP_AUTH"],
    secret_literal_prefix: [],
    conventional_paths: [
      "/webhooks/postmark",
      "/api/webhooks/postmark",
      "/postmark/webhook",
      "/postmark/inbound",
      "/postmark/outbound",
      "/postmark/bounce",
    ],
    hmac_algorithm: "sha256",
    signing_input_format: "custom",
    timestamp_header: null,
    signature_encoding: "hex",
    applicable_rules: [
      "missing-signature-verification",
      "missing-basic-auth",
      "missing-ip-allowlist",
      "timing-unsafe-comparison",
      "raw-body-misuse",
      "unreachable-verification",
      "verify-after-side-effect",
      "verification-error-swallowed",
      "test-mode-bypass",
      "secret-in-log-or-error",
    ],
    // v0.7 Rule Depth (VAS-01)
    ...SHARED_VAS_SINKS,
    provider_api_hosts: ["api.postmarkapp.com"],
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
      "verify-after-side-effect",
      "verification-error-swallowed",
      "test-mode-bypass",
      "secret-in-log-or-error",
    ],
    // v0.7 Rule Depth (VAS-01)
    ...SHARED_VAS_SINKS,
    provider_api_hosts: ["api.mailchimp.com"],
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
      "verify-after-side-effect",
      "verification-error-swallowed",
      "test-mode-bypass",
      "secret-in-log-or-error",
    ],
    // v0.7 Rule Depth (VAS-01)
    ...SHARED_VAS_SINKS,
    provider_api_hosts: ["api.hubapi.com"],
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
      "verify-after-side-effect",
      "verification-error-swallowed",
      "test-mode-bypass",
      "secret-in-log-or-error",
    ],
    // v0.7 Rule Depth (VAS-01)
    ...SHARED_VAS_SINKS,
    provider_api_hosts: [],
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
      "verify-after-side-effect",
      "verification-error-swallowed",
      "test-mode-bypass",
      "secret-in-log-or-error",
    ],
    // v0.7 Rule Depth (VAS-01)
    ...SHARED_VAS_SINKS,
    provider_api_hosts: ["docusign.net"],
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
      "verify-after-side-effect",
      "verification-error-swallowed",
      "test-mode-bypass",
      "secret-in-log-or-error",
    ],
    // v0.7 Rule Depth (VAS-01)
    ...SHARED_VAS_SINKS,
    provider_api_hosts: ["api.linear.app"],
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
      "octokit-cross-attribution",
      "verify-after-side-effect",
      "verification-error-swallowed",
      "test-mode-bypass",
      "secret-in-log-or-error",
    ],
    // v0.7 Rule Depth (VAS-01)
    ...SHARED_VAS_SINKS,
    provider_api_hosts: ["api.intercom.io"],
  },
  // Phase 8.3 Plan 01 — Zendesk Connect webhooks. Same signing scheme as Slack
  // (timestamp_dot_body, sha256, base64 — `${timestamp}${rawBody}` HMAC). No canonical
  // first-party webhook SDK; Zendesk docs ship inline HMAC samples. The `sdk_packages`
  // entries below are Zendesk's general API SDKs (NOT webhook-specific) — they satisfy
  // the catalog-shape contract and let library-import detection at least fire on
  // codebases that pull in the API SDK. Per Phase 6b research clean-schema fit, no
  // catalog branch needed.
  // Phase 8.3 Plan 15 — Zoom webhooks. Two-phase auth: initial URL-validation
  // handshake (HMAC of `plainToken` echo on first delivery) + signed payloads
  // thereafter with HMAC-SHA256 over `v0:${X-Zm-Request-Timestamp}:${rawBody}`
  // (Slack signing recipe). signing_input_format: 'timestamp_dot_body' is
  // identical to Slack and reuses the catalog-parameterized factories — no
  // new generic predicate authored per the plan's "REUSE Slack v0: family"
  // directive. The dedicated `url-validation-only` rule (predicate at
  // predicates/zoom-url-validation-only.ts) catches the documented bug
  // pattern: handler passes URL validation but never verifies
  // X-Zm-Signature on runtime events. signature_header value is `v0=<hex>`;
  // the catalog signature_encoding is the encoding of the hex portion only
  // (the `v0=` prefix is part of the format the handler must parse).
  zoom: {
    signature_header: ["x-zm-signature"],
    sdk_packages: ["@zoom/appssdk", "zoomus"],
    sdk_verify_calls: ["verifyZoomSignature", "verifyWebhookSignature"],
    secret_env_prefix: ["ZOOM_WEBHOOK", "ZOOM_SECRET_TOKEN", "ZOOM_SIGNING"],
    secret_literal_prefix: [],
    conventional_paths: ["/webhooks/zoom", "/api/webhooks/zoom", "/zoom/webhook", "/zoom/webhooks"],
    hmac_algorithm: "sha256",
    signing_input_format: "timestamp_dot_body",
    timestamp_header: "x-zm-request-timestamp",
    signature_encoding: "hex",
    applicable_rules: [
      "missing-signature-verification",
      "url-validation-only",
      "timing-unsafe-comparison",
      "raw-body-misuse",
      "missing-timestamp-check",
      "wrong-hmac-algorithm",
      "unreachable-verification",
      "verify-after-side-effect",
      "verification-error-swallowed",
      "test-mode-bypass",
      "secret-in-log-or-error",
    ],
    // v0.7 Rule Depth (VAS-01)
    ...SHARED_VAS_SINKS,
    provider_api_hosts: ["api.zoom.us"],
  },
  // Phase 8.3 Plan 14 — Calendly webhooks. The signature header is comma-separated
  // `t=<unix>,v1=<hex>` (Stripe-shaped) with the inner HMAC computed over
  // `${timestamp}.${rawBody}` (Slack-shaped signing recipe). The catalog combines
  // these primitives: signing_input_format='timestamp_dot_body' with timestamp_header
  // null because the timestamp lives inside the signature header (`t=...`), not in a
  // separate header. The dedicated `signature-header-parse-mishandled` rule
  // (predicate at predicates/calendly-header-parse.ts) catches handlers that don't
  // parse the comma-separated header into its t= and v1= components — a real bug:
  // hashing the full header value against bare HMAC or using the entire header as
  // the comparison target both fail every delivery.
  // No canonical first-party webhook-verification SDK. [unverified-against-docs]
  // tag recorded in 08.3-14-SUMMARY.md.
  calendly: {
    signature_header: ["calendly-webhook-signature"],
    sdk_packages: ["@calendly/api", "calendly-python"],
    sdk_verify_calls: ["verifyCalendlySignature", "verifyWebhookSignature"],
    secret_env_prefix: ["CALENDLY_WEBHOOK", "CALENDLY_SIGNING"],
    secret_literal_prefix: [],
    conventional_paths: [
      "/webhooks/calendly",
      "/api/webhooks/calendly",
      "/calendly/webhook",
      "/calendly/webhooks",
    ],
    hmac_algorithm: "sha256",
    signing_input_format: "timestamp_dot_body",
    timestamp_header: null,
    signature_encoding: "hex",
    applicable_rules: [
      "missing-signature-verification",
      "timing-unsafe-comparison",
      "raw-body-misuse",
      "missing-timestamp-check",
      "wrong-hmac-algorithm",
      "unreachable-verification",
      "signature-header-parse-mishandled",
      "verify-after-side-effect",
      "verification-error-swallowed",
      "test-mode-bypass",
      "secret-in-log-or-error",
    ],
    // v0.7 Rule Depth (VAS-01)
    ...SHARED_VAS_SINKS,
    provider_api_hosts: ["api.calendly.com"],
  },
  // Phase 8.3 Plan 13 — Notion webhooks. Two-phase auth model: initial
  // verification-token echo (handler must respond with the token sent in the
  // first delivery) plus HMAC-SHA256 hex signed payloads thereafter under
  // `X-Notion-Signature`. signing_input_format: 'custom' dispatches to
  // CUSTOM_SIGNING_PREDICATES['notion'] at predicates/custom/notion-signing.ts
  // (D-92, sixth occupant). Dedicated `verification-token-only` rule (predicate
  // at predicates/notion-verification-token-only.ts) catches handlers that
  // read X-Notion-Signature but never compute HMAC — likely comparing the
  // signature header against a stored verification token rather than verifying it.
  // No canonical first-party webhook-verification SDK; @notionhq/client +
  // notion-client + notion-sdk-py are API clients. [unverified-against-docs] tag
  // recorded in 08.3-13-SUMMARY.md.
  notion: {
    signature_header: ["x-notion-signature"],
    sdk_packages: ["@notionhq/client", "notion-client", "notion-sdk-py", "Notion\\"],
    sdk_verify_calls: ["verifyNotionSignature", "verifyWebhookSignature"],
    secret_env_prefix: ["NOTION_WEBHOOK", "NOTION_SIGNING", "NOTION_VERIFICATION_TOKEN"],
    secret_literal_prefix: [],
    conventional_paths: [
      "/webhooks/notion",
      "/api/webhooks/notion",
      "/notion/webhook",
      "/notion/webhooks",
    ],
    hmac_algorithm: "sha256",
    signing_input_format: "custom",
    timestamp_header: null,
    signature_encoding: "hex",
    applicable_rules: [
      "missing-signature-verification",
      "verification-token-only",
      "timing-unsafe-comparison",
      "raw-body-misuse",
      "wrong-hmac-algorithm",
      "unreachable-verification",
      "verify-after-side-effect",
      "verification-error-swallowed",
      "test-mode-bypass",
      "secret-in-log-or-error",
    ],
    // v0.7 Rule Depth (VAS-01)
    ...SHARED_VAS_SINKS,
    provider_api_hosts: ["api.notion.com"],
  },
  // Phase 8.3 Plan 12 — Bitbucket Cloud webhooks. Clean raw_body / sha256 / hex
  // fit for the catalog shape, BUT (like GitHub-legacy) the header value is
  // formatted as `sha256=<hex>` — the `sha256=` prefix MUST be stripped before
  // comparing against a bare HMAC hex digest. Handlers that compare the full
  // header value against bare HMAC silently reject every delivery. The dedicated
  // `bitbucket-signature-prefix-not-stripped` rule (NEW predicate at
  // predicates/bitbucket-signature-prefix.ts) emits manual-review on this pattern.
  //
  // X-Hub-Signature is THREE-way shared (github / intercom / bitbucket). All three
  // catalog-parameterized predicates scope to handler.provider — disambiguation
  // tests guard the contract.
  //
  // No canonical first-party webhook-verification SDK; Atlassian's Bitbucket Cloud
  // API clients are general-purpose. sdk_verify_calls are narrow plausible names.
  // [unverified-against-docs] tag recorded in 08.3-12-SUMMARY.md.
  bitbucket: {
    signature_header: ["x-hub-signature"],
    sdk_packages: ["bitbucket", "atlassian-python-api"],
    sdk_verify_calls: ["verifyBitbucketSignature", "verifyWebhookSignature"],
    secret_env_prefix: ["BITBUCKET_WEBHOOK", "BITBUCKET_SIGNING", "BB_WEBHOOK"],
    secret_literal_prefix: [],
    conventional_paths: [
      "/webhooks/bitbucket",
      "/api/webhooks/bitbucket",
      "/bitbucket/webhook",
      "/bitbucket/webhooks",
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
      "signature-prefix-not-stripped",
      "verify-after-side-effect",
      "verification-error-swallowed",
      "test-mode-bypass",
      "secret-in-log-or-error",
    ],
    // v0.7 Rule Depth (VAS-01)
    ...SHARED_VAS_SINKS,
    provider_api_hosts: ["api.bitbucket.org"],
  },
  // Phase 8.3 Plan 11 — PagerDuty v3 webhooks. Clean raw_body / sha256 / hex fit
  // for the catalog shape, BUT the header value is comma-separated `v1=<hex>,v1=<hex>`
  // — multiple signatures during key rotation. The catalog shape doesn't model
  // multi-token signature headers natively; the dedicated
  // `pagerduty-multi-signature-rotation-mishandled` rule (NEW predicate at
  // predicates/pagerduty-multi-signature.ts) emits manual-review when manual HMAC
  // is reachable but no comma-iteration symbol (.split / .forEach / .map) is
  // reachable — the rotation bug pattern. The remaining six catalog-parameterized
  // rules behave as Linear/Auth0/Datadog/Sentry. No canonical first-party
  // webhook-verification SDK; @pagerduty/pdjs and the Python pdpyras client are
  // API clients, not webhook verifiers. [unverified-against-docs] tag recorded
  // in 08.3-11-SUMMARY.md.
  pagerduty: {
    signature_header: ["x-pagerduty-signature"],
    sdk_packages: ["@pagerduty/pdjs", "pdpyras"],
    sdk_verify_calls: ["verifyPagerDutySignature", "verifyWebhookSignature"],
    secret_env_prefix: ["PAGERDUTY_WEBHOOK", "PAGERDUTY_SIGNING", "PD_WEBHOOK"],
    secret_literal_prefix: [],
    conventional_paths: [
      "/webhooks/pagerduty",
      "/api/webhooks/pagerduty",
      "/pagerduty/webhook",
      "/pagerduty/webhooks",
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
      "multi-signature-rotation-mishandled",
      "verify-after-side-effect",
      "verification-error-swallowed",
      "test-mode-bypass",
      "secret-in-log-or-error",
    ],
    // v0.7 Rule Depth (VAS-01)
    ...SHARED_VAS_SINKS,
    provider_api_hosts: ["api.pagerduty.com"],
  },
  // Phase 8.3 Plan 10 — Sentry Integration Platform webhooks. Clean raw_body /
  // sha256 / hex fit (closest analog: Linear, Auth0, Datadog). Dedicated
  // `Sentry-Hook-Signature` header — no cross-provider attribution risk.
  // Companion `Sentry-Hook-Resource` header is used by handlers for event-type
  // routing, NOT verification (not stored in the catalog because it's not a
  // signature input). No canonical first-party webhook-verification SDK;
  // @sentry/node + @sentry/browser + sentry-sdk are observability clients, not
  // webhook verifiers. sdk_verify_calls are narrow plausible function names
  // users might write. [unverified-against-docs] tag recorded in
  // 08.3-10-SUMMARY.md — live Sentry docs page was not fetched in this session.
  sentry: {
    signature_header: ["sentry-hook-signature"],
    sdk_packages: ["@sentry/node", "@sentry/browser", "sentry-sdk", "Sentry\\"],
    sdk_verify_calls: ["verifySentrySignature", "verifyWebhookSignature"],
    secret_env_prefix: ["SENTRY_WEBHOOK", "SENTRY_CLIENT_SECRET", "SENTRY_INTEGRATION"],
    secret_literal_prefix: [],
    conventional_paths: [
      "/webhooks/sentry",
      "/api/webhooks/sentry",
      "/sentry/webhooks",
      "/sentry/webhook",
    ],
    hmac_algorithm: "sha256",
    signing_input_format: "raw_body",
    // Verified against live docs 2026-05-30 — Sentry sends Sentry-Hook-Timestamp
    // alongside Sentry-Hook-Signature. v0.6.0 Plan 19 pre-push fix.
    timestamp_header: "sentry-hook-timestamp",
    signature_encoding: "hex",
    applicable_rules: [
      "missing-signature-verification",
      "timing-unsafe-comparison",
      "raw-body-misuse",
      "missing-timestamp-check",
      "wrong-hmac-algorithm",
      "unreachable-verification",
      "header-confusion",
      "verify-after-side-effect",
      "verification-error-swallowed",
      "test-mode-bypass",
      "secret-in-log-or-error",
    ],
    // v0.7 Rule Depth (VAS-01)
    ...SHARED_VAS_SINKS,
    provider_api_hosts: ["sentry.io"],
  },
  // Phase 8.3 Plan 09 DEFERRED — Datadog Webhooks integration does NOT
  // natively HMAC-sign outbound payloads (verified 2026-05-30 via Svix's
  // public webhook review + Datadog's own integration docs which only
  // document HTTP Basic Auth + OAuth 2.0 authentication, no signature
  // header). The original Plan 09 catalog entry shipped pinned defaults
  // from training-data inference and would have FALSE-POSITIVED on every
  // real Datadog handler. Removed pre-v0.6.0 release per Plan 19 SUMMARY
  // blocker 1 resolution path (b). Plan 09b backlog: re-model Datadog
  // as a Postmark-shape Basic-Auth-+-credential-presence rule pack once
  // authoritative Datadog docs confirm the actual integration shape, or
  // accept Datadog as out-of-scope for the catalog-parameterized factory
  // pattern.
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
      "verify-after-side-effect",
      "verification-error-swallowed",
      "test-mode-bypass",
      "secret-in-log-or-error",
    ],
    // v0.7 Rule Depth (VAS-01)
    ...SHARED_VAS_SINKS,
    provider_api_hosts: ["zendesk.com"],
  },
};
