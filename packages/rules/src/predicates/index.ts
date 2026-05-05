// 21 registered predicate keys (Phase 6 D-93 refactor + 06.2 Shopify pack):
//   github-timing-safe-equal, express-middleware-ordering,
//   stripe-library-verified, github-library-verified, shopify-library-verified,
//   stripe-missing-signature-verification, stripe-timing-unsafe-comparison,
//   stripe-raw-body-misuse, stripe-missing-timestamp-check,
//   stripe-wrong-hmac-algorithm, stripe-unreachable-verification,
//   github-missing-signature-verification, github-raw-body-misuse,
//   github-missing-timestamp-check, github-wrong-hmac-algorithm,
//   github-unreachable-verification,
//   shopify-missing-signature-verification, shopify-timing-unsafe-comparison,
//   shopify-raw-body-misuse, shopify-missing-timestamp-check,
//   shopify-wrong-hmac-algorithm, shopify-unreachable-verification
//
// Implementations come from catalog-parameterized factory files (D-90, D-91).
// Per-provider names import the bound exports from those factories.

import type { RulePredicate } from "@hookwarden/engine";
import { expressMiddlewareOrderingPredicate } from "./express-middleware-ordering.js";
import { githubTimingSafeEqualPredicate } from "./github-timing-safe-equal.js";
import {
  githubLibraryVerifiedPredicate,
  shopifyLibraryVerifiedPredicate,
  stripeLibraryVerifiedPredicate,
} from "./library-verified-recognition.js";
import {
  githubMissingSignatureVerificationPredicate,
  shopifyMissingSignatureVerificationPredicate,
  stripeMissingSignatureVerificationPredicate,
} from "./missing-signature-verification.js";
import {
  githubMissingTimestampCheckPredicate,
  shopifyMissingTimestampCheckPredicate,
  stripeMissingTimestampCheckPredicate,
} from "./missing-timestamp-check.js";
import {
  githubRawBodyMisusePredicate,
  shopifyRawBodyMisusePredicate,
  stripeRawBodyMisusePredicate,
} from "./raw-body-misuse.js";
import {
  shopifyTimingUnsafeComparisonPredicate,
  stripeTimingUnsafeComparisonPredicate,
} from "./timing-unsafe-comparison.js";
import {
  githubUnreachableVerificationPredicate,
  shopifyUnreachableVerificationPredicate,
  stripeUnreachableVerificationPredicate,
} from "./unreachable-verification.js";
import {
  githubWrongHmacAlgorithmPredicate,
  shopifyWrongHmacAlgorithmPredicate,
  stripeWrongHmacAlgorithmPredicate,
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
};
