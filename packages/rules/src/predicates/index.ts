import type { RulePredicate } from "@hookwarden/engine";
import { expressMiddlewareOrderingPredicate } from "./express-middleware-ordering.js";
import { githubTimingSafeEqualPredicate } from "./github-timing-safe-equal.js";
import {
  githubLibraryVerifiedPredicate,
  stripeLibraryVerifiedPredicate,
} from "./library-verified-recognition.js";

export const ALL_PREDICATES: Readonly<Record<string, RulePredicate>> = {
  "github-timing-safe-equal": githubTimingSafeEqualPredicate,
  "express-middleware-ordering": expressMiddlewareOrderingPredicate,
  "stripe-library-verified": stripeLibraryVerifiedPredicate,
  "github-library-verified": githubLibraryVerifiedPredicate,
};
