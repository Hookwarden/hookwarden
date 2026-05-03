import type { RulePredicate } from "@hookwarden/engine";
import { expressMiddlewareOrderingPredicate } from "./express-middleware-ordering.js";
import { githubTimingSafeEqualPredicate } from "./github-timing-safe-equal.js";
import {
  githubLibraryVerifiedPredicate,
  stripeLibraryVerifiedPredicate,
} from "./library-verified-recognition.js";
import { stripeMissingSignatureVerificationPredicate } from "./stripe-missing-signature-verification.js";
import { stripeMissingTimestampCheckPredicate } from "./stripe-missing-timestamp-check.js";
import { stripeRawBodyMisusePredicate } from "./stripe-raw-body-misuse.js";
import { stripeTimingUnsafeComparisonPredicate } from "./stripe-timing-unsafe-comparison.js";
import { stripeUnreachableVerificationPredicate } from "./stripe-unreachable-verification.js";
import { stripeWrongHmacAlgorithmPredicate } from "./stripe-wrong-hmac-algorithm.js";

export const ALL_PREDICATES: Readonly<Record<string, RulePredicate>> = {
  // Phase 2 / Wave 1
  "github-timing-safe-equal": githubTimingSafeEqualPredicate,
  // Wave 2 cross-cutting
  "express-middleware-ordering": expressMiddlewareOrderingPredicate,
  "stripe-library-verified": stripeLibraryVerifiedPredicate,
  "github-library-verified": githubLibraryVerifiedPredicate,
  // Wave 3 Stripe pack (Plan 04 will append the GitHub pack on top of this)
  "stripe-missing-signature-verification": stripeMissingSignatureVerificationPredicate,
  "stripe-timing-unsafe-comparison": stripeTimingUnsafeComparisonPredicate,
  "stripe-raw-body-misuse": stripeRawBodyMisusePredicate,
  "stripe-missing-timestamp-check": stripeMissingTimestampCheckPredicate,
  "stripe-wrong-hmac-algorithm": stripeWrongHmacAlgorithmPredicate,
  "stripe-unreachable-verification": stripeUnreachableVerificationPredicate,
};
