// 28 registered predicate keys (Phase 6 D-93 refactor + 06.2 Shopify + 06.3 Twilio):
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

import type { RulePredicate } from "@hookwarden/engine";
import { expressMiddlewareOrderingPredicate } from "./express-middleware-ordering.js";
import { githubTimingSafeEqualPredicate } from "./github-timing-safe-equal.js";
import {
  githubLibraryVerifiedPredicate,
  shopifyLibraryVerifiedPredicate,
  slackLibraryVerifiedPredicate,
  squareLibraryVerifiedPredicate,
  stripeLibraryVerifiedPredicate,
  twilioLibraryVerifiedPredicate,
} from "./library-verified-recognition.js";
import {
  githubMissingSignatureVerificationPredicate,
  shopifyMissingSignatureVerificationPredicate,
  slackMissingSignatureVerificationPredicate,
  squareMissingSignatureVerificationPredicate,
  stripeMissingSignatureVerificationPredicate,
  twilioMissingSignatureVerificationPredicate,
} from "./missing-signature-verification.js";
import {
  githubMissingTimestampCheckPredicate,
  shopifyMissingTimestampCheckPredicate,
  slackMissingTimestampCheckPredicate,
  stripeMissingTimestampCheckPredicate,
  twilioMissingTimestampCheckPredicate,
} from "./missing-timestamp-check.js";
import {
  githubRawBodyMisusePredicate,
  shopifyRawBodyMisusePredicate,
  slackRawBodyMisusePredicate,
  squareRawBodyMisusePredicate,
  stripeRawBodyMisusePredicate,
  twilioRawBodyMisusePredicate,
} from "./raw-body-misuse.js";
import {
  shopifyTimingUnsafeComparisonPredicate,
  slackTimingUnsafeComparisonPredicate,
  squareTimingUnsafeComparisonPredicate,
  stripeTimingUnsafeComparisonPredicate,
  twilioTimingUnsafeComparisonPredicate,
} from "./timing-unsafe-comparison.js";
import {
  githubUnreachableVerificationPredicate,
  shopifyUnreachableVerificationPredicate,
  slackUnreachableVerificationPredicate,
  squareUnreachableVerificationPredicate,
  stripeUnreachableVerificationPredicate,
  twilioUnreachableVerificationPredicate,
} from "./unreachable-verification.js";
import {
  githubWrongHmacAlgorithmPredicate,
  shopifyWrongHmacAlgorithmPredicate,
  slackWrongHmacAlgorithmPredicate,
  squareWrongHmacAlgorithmPredicate,
  stripeWrongHmacAlgorithmPredicate,
  twilioWrongHmacAlgorithmPredicate,
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
};
