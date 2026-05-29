// Registered predicate keys (Phase 6 D-93 refactor + 06.2 Shopify + 06.3 Twilio
// + 06.4 Slack + 06.5 Square + 8.1 Plan 08 PHP + 8.3 Plan 01 Zendesk + 8.3 Plan 16
// Standard Webhooks + 8.3 Plan 03 Intercom):
//   github-timing-safe-equal, express-middleware-ordering,
//   stripe-library-verified, github-library-verified, shopify-library-verified, twilio-library-verified,
//   stripe-missing-signature-verification, stripe-timing-unsafe-comparison,
//   stripe-raw-body-misuse, stripe-missing-timestamp-check,
//   stripe-wrong-hmac-algorithm, stripe-unreachable-verification,
//   github-missing-signature-verification, github-raw-body-misuse,
//   github-missing-timestamp-check, github-wrong-hmac-algorithm,
//   github-unreachable-verification,
//   shopify-{missing-signature-verification, timing-unsafe-comparison, raw-body-misuse,
//            missing-timestamp-check, wrong-hmac-algorithm, unreachable-verification},
//   twilio-{missing-signature-verification, timing-unsafe-comparison, raw-body-misuse,
//           missing-timestamp-check, wrong-hmac-algorithm, unreachable-verification}
//
// Implementations come from catalog-parameterized factory files (D-90, D-91). Twilio's
// missing-signature-verification dispatches through CUSTOM_SIGNING_PREDICATES['twilio']
// (D-92) at predicates/custom/twilio-signing.ts.

// Custom-predicate side-effect registrations (D-92). Each import populates
// CUSTOM_SIGNING_PREDICATES[<provider>] at module-load time. Living here (not in
// missing-signature-verification.ts) avoids the circular dep where each custom predicate
// imports CUSTOM_SIGNING_PREDICATES from missing-signature-verification.js.
import "./custom/twilio-signing.js";
import "./custom/standardwebhooks-signing.js";

import type { RulePredicate } from "@hookwarden/engine";
import { expressMiddlewareOrderingPredicate } from "./express-middleware-ordering.js";
import { githubPhpTimingSafeEqualPredicate } from "./github-php-timing-safe-equal.js";
import { githubTimingSafeEqualPredicate } from "./github-timing-safe-equal.js";
import {
  githubLibraryVerifiedPredicate,
  shopifyLibraryVerifiedPredicate,
  slackLibraryVerifiedPredicate,
  squareLibraryVerifiedPredicate,
  standardwebhooksLibraryVerifiedPredicate,
  stripeLibraryVerifiedPredicate,
  twilioLibraryVerifiedPredicate,
} from "./library-verified-recognition.js";
import {
  docusignMissingSignatureVerificationPredicate,
  githubMissingSignatureVerificationPredicate,
  intercomMissingSignatureVerificationPredicate,
  linearMissingSignatureVerificationPredicate,
  shopifyMissingSignatureVerificationPredicate,
  slackMissingSignatureVerificationPredicate,
  squareMissingSignatureVerificationPredicate,
  standardwebhooksMissingSignatureVerificationPredicate,
  stripeMissingSignatureVerificationPredicate,
  twilioMissingSignatureVerificationPredicate,
  zendeskMissingSignatureVerificationPredicate,
} from "./missing-signature-verification.js";
import {
  docusignMissingTimestampCheckPredicate,
  githubMissingTimestampCheckPredicate,
  intercomMissingTimestampCheckPredicate,
  linearMissingTimestampCheckPredicate,
  shopifyMissingTimestampCheckPredicate,
  slackMissingTimestampCheckPredicate,
  standardwebhooksMissingTimestampCheckPredicate,
  stripeMissingTimestampCheckPredicate,
  twilioMissingTimestampCheckPredicate,
  zendeskMissingTimestampCheckPredicate,
} from "./missing-timestamp-check.js";
import {
  docusignRawBodyMisusePredicate,
  githubRawBodyMisusePredicate,
  intercomRawBodyMisusePredicate,
  linearRawBodyMisusePredicate,
  shopifyRawBodyMisusePredicate,
  slackRawBodyMisusePredicate,
  squareRawBodyMisusePredicate,
  standardwebhooksRawBodyMisusePredicate,
  stripeRawBodyMisusePredicate,
  twilioRawBodyMisusePredicate,
  zendeskRawBodyMisusePredicate,
} from "./raw-body-misuse.js";
import { stripePhpTimingUnsafeComparisonPredicate } from "./stripe-php-timing-unsafe-comparison.js";
import {
  docusignTimingUnsafeComparisonPredicate,
  intercomTimingUnsafeComparisonPredicate,
  linearTimingUnsafeComparisonPredicate,
  shopifyTimingUnsafeComparisonPredicate,
  slackTimingUnsafeComparisonPredicate,
  squareTimingUnsafeComparisonPredicate,
  standardwebhooksTimingUnsafeComparisonPredicate,
  stripeTimingUnsafeComparisonPredicate,
  twilioTimingUnsafeComparisonPredicate,
  zendeskTimingUnsafeComparisonPredicate,
} from "./timing-unsafe-comparison.js";
import {
  docusignUnreachableVerificationPredicate,
  githubUnreachableVerificationPredicate,
  intercomUnreachableVerificationPredicate,
  linearUnreachableVerificationPredicate,
  shopifyUnreachableVerificationPredicate,
  slackUnreachableVerificationPredicate,
  squareUnreachableVerificationPredicate,
  standardwebhooksUnreachableVerificationPredicate,
  stripeUnreachableVerificationPredicate,
  twilioUnreachableVerificationPredicate,
  zendeskUnreachableVerificationPredicate,
} from "./unreachable-verification.js";
import {
  docusignWrongHmacAlgorithmPredicate,
  githubWrongHmacAlgorithmPredicate,
  intercomWrongHmacAlgorithmPredicate,
  linearWrongHmacAlgorithmPredicate,
  shopifyWrongHmacAlgorithmPredicate,
  slackWrongHmacAlgorithmPredicate,
  squareWrongHmacAlgorithmPredicate,
  standardwebhooksWrongHmacAlgorithmPredicate,
  stripeWrongHmacAlgorithmPredicate,
  twilioWrongHmacAlgorithmPredicate,
  zendeskWrongHmacAlgorithmPredicate,
} from "./wrong-hmac-algorithm.js";

export const ALL_PREDICATES: Readonly<Record<string, RulePredicate>> = {
  // Phase 2 / Wave 1
  "github-timing-safe-equal": githubTimingSafeEqualPredicate,
  // Wave 2 cross-cutting
  "express-middleware-ordering": expressMiddlewareOrderingPredicate,
  "stripe-library-verified": stripeLibraryVerifiedPredicate,
  "github-library-verified": githubLibraryVerifiedPredicate,
  // Wave 3 Stripe pack (D-93 refactor — sourced from catalog-parameterized factories)
  "stripe-missing-signature-verification": stripeMissingSignatureVerificationPredicate,
  "stripe-timing-unsafe-comparison": stripeTimingUnsafeComparisonPredicate,
  "stripe-raw-body-misuse": stripeRawBodyMisusePredicate,
  "stripe-missing-timestamp-check": stripeMissingTimestampCheckPredicate,
  "stripe-wrong-hmac-algorithm": stripeWrongHmacAlgorithmPredicate,
  "stripe-unreachable-verification": stripeUnreachableVerificationPredicate,
  // Wave 4 GitHub pack (D-93 refactor — sourced from catalog-parameterized factories)
  "github-missing-signature-verification": githubMissingSignatureVerificationPredicate,
  "github-raw-body-misuse": githubRawBodyMisusePredicate,
  "github-missing-timestamp-check": githubMissingTimestampCheckPredicate,
  "github-wrong-hmac-algorithm": githubWrongHmacAlgorithmPredicate,
  "github-unreachable-verification": githubUnreachableVerificationPredicate,
  // Phase 6.2 Shopify pack (parameterized raw_body recipe; no custom predicate)
  "shopify-library-verified": shopifyLibraryVerifiedPredicate,
  "shopify-missing-signature-verification": shopifyMissingSignatureVerificationPredicate,
  "shopify-timing-unsafe-comparison": shopifyTimingUnsafeComparisonPredicate,
  "shopify-raw-body-misuse": shopifyRawBodyMisusePredicate,
  "shopify-missing-timestamp-check": shopifyMissingTimestampCheckPredicate,
  "shopify-wrong-hmac-algorithm": shopifyWrongHmacAlgorithmPredicate,
  "shopify-unreachable-verification": shopifyUnreachableVerificationPredicate,
  // Phase 6.3 Twilio pack (signing_input_format: 'custom' — dispatches via D-92 custom slot)
  "twilio-library-verified": twilioLibraryVerifiedPredicate,
  "twilio-missing-signature-verification": twilioMissingSignatureVerificationPredicate,
  "twilio-timing-unsafe-comparison": twilioTimingUnsafeComparisonPredicate,
  "twilio-raw-body-misuse": twilioRawBodyMisusePredicate,
  "twilio-missing-timestamp-check": twilioMissingTimestampCheckPredicate,
  "twilio-wrong-hmac-algorithm": twilioWrongHmacAlgorithmPredicate,
  "twilio-unreachable-verification": twilioUnreachableVerificationPredicate,
  // Phase 6.4 Slack pack (signing_input_format: 'timestamp_dot_body'; first non-null timestamp_header)
  "slack-library-verified": slackLibraryVerifiedPredicate,
  "slack-missing-signature-verification": slackMissingSignatureVerificationPredicate,
  "slack-timing-unsafe-comparison": slackTimingUnsafeComparisonPredicate,
  "slack-raw-body-misuse": slackRawBodyMisusePredicate,
  "slack-missing-timestamp-check": slackMissingTimestampCheckPredicate,
  "slack-wrong-hmac-algorithm": slackWrongHmacAlgorithmPredicate,
  "slack-unreachable-verification": slackUnreachableVerificationPredicate,
  // Phase 6.5 Square pack (signing_input_format: 'custom_field_tuple'; URL+body canonical-string;
  // no missing-timestamp-check, no hardcoded-secret-prefix per D-95 verification)
  "square-library-verified": squareLibraryVerifiedPredicate,
  "square-missing-signature-verification": squareMissingSignatureVerificationPredicate,
  "square-timing-unsafe-comparison": squareTimingUnsafeComparisonPredicate,
  "square-raw-body-misuse": squareRawBodyMisusePredicate,
  "square-wrong-hmac-algorithm": squareWrongHmacAlgorithmPredicate,
  "square-unreachable-verification": squareUnreachableVerificationPredicate,
  // Phase 8.1 Plan 08 PHP-specific predicates (D-04 layer 2 — per-provider PHP anchors that
  // can't be expressed via the language-agnostic reachable_symbols path because engine
  // reachability is bounded to babel + tree-sitter-python in v1).
  "stripe-php-timing-unsafe-comparison": stripePhpTimingUnsafeComparisonPredicate,
  "github-php-timing-safe-equal": githubPhpTimingSafeEqualPredicate,
  // Phase 8.3 Plan 01 Zendesk pack (signing_input_format: 'timestamp_dot_body' — Slack analog).
  // No library-verified rule: Zendesk has no canonical first-party webhook SDK.
  "zendesk-missing-signature-verification": zendeskMissingSignatureVerificationPredicate,
  "zendesk-timing-unsafe-comparison": zendeskTimingUnsafeComparisonPredicate,
  "zendesk-raw-body-misuse": zendeskRawBodyMisusePredicate,
  "zendesk-missing-timestamp-check": zendeskMissingTimestampCheckPredicate,
  "zendesk-wrong-hmac-algorithm": zendeskWrongHmacAlgorithmPredicate,
  "zendesk-unreachable-verification": zendeskUnreachableVerificationPredicate,
  // Phase 8.3 Plan 03 Intercom pack (signing_input_format: 'raw_body' — GitHub analog;
  // X-Hub-Signature is literally GitHub's own header name). No library-verified rule:
  // Intercom has no canonical first-party webhook SDK (intercom-client is the general
  // API SDK, not a webhook verifier).
  "intercom-missing-signature-verification": intercomMissingSignatureVerificationPredicate,
  "intercom-timing-unsafe-comparison": intercomTimingUnsafeComparisonPredicate,
  "intercom-raw-body-misuse": intercomRawBodyMisusePredicate,
  "intercom-missing-timestamp-check": intercomMissingTimestampCheckPredicate,
  "intercom-wrong-hmac-algorithm": intercomWrongHmacAlgorithmPredicate,
  "intercom-unreachable-verification": intercomUnreachableVerificationPredicate,
  // Phase 8.3 Plan 04 Linear pack (signing_input_format: 'raw_body' — GitHub analog;
  // dedicated `Linear-Signature` header, no cross-provider attribution risk). No
  // library-verified rule: Linear has no canonical first-party webhook SDK
  // (@linear/sdk is the general GraphQL SDK, not a webhook verifier).
  "linear-missing-signature-verification": linearMissingSignatureVerificationPredicate,
  "linear-timing-unsafe-comparison": linearTimingUnsafeComparisonPredicate,
  "linear-raw-body-misuse": linearRawBodyMisusePredicate,
  "linear-missing-timestamp-check": linearMissingTimestampCheckPredicate,
  "linear-wrong-hmac-algorithm": linearWrongHmacAlgorithmPredicate,
  "linear-unreachable-verification": linearUnreachableVerificationPredicate,
  // Phase 8.3 Plan 02 DocuSign Connect pack (signing_input_format: 'raw_body' —
  // Shopify analog; dedicated `X-DocuSign-Signature-1` header, sha256/base64).
  // No library-verified rule: DocuSign Connect does not ship a first-party
  // webhook-verification SDK (docusign-esign is the general eSign SDK).
  "docusign-missing-signature-verification": docusignMissingSignatureVerificationPredicate,
  "docusign-timing-unsafe-comparison": docusignTimingUnsafeComparisonPredicate,
  "docusign-raw-body-misuse": docusignRawBodyMisusePredicate,
  "docusign-missing-timestamp-check": docusignMissingTimestampCheckPredicate,
  "docusign-wrong-hmac-algorithm": docusignWrongHmacAlgorithmPredicate,
  "docusign-unreachable-verification": docusignUnreachableVerificationPredicate,
  // Phase 8.3 Plan 16 Standard Webhooks spec (signing_input_format: 'custom' — dispatches
  // via D-92 custom slot at predicates/custom/standardwebhooks-signing.ts). Library-prong
  // detection only; hand-rolled structural AST detection deferred to Plan 16b.
  "standardwebhooks-library-verified": standardwebhooksLibraryVerifiedPredicate,
  "standardwebhooks-missing-signature-verification":
    standardwebhooksMissingSignatureVerificationPredicate,
  "standardwebhooks-timing-unsafe-comparison": standardwebhooksTimingUnsafeComparisonPredicate,
  "standardwebhooks-raw-body-misuse": standardwebhooksRawBodyMisusePredicate,
  "standardwebhooks-missing-timestamp-check": standardwebhooksMissingTimestampCheckPredicate,
  "standardwebhooks-wrong-hmac-algorithm": standardwebhooksWrongHmacAlgorithmPredicate,
  "standardwebhooks-unreachable-verification": standardwebhooksUnreachableVerificationPredicate,
};
