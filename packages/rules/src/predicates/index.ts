import type { RulePredicate } from "@hookwarden/engine";
import { githubTimingSafeEqualPredicate } from "./github-timing-safe-equal.js";

export const ALL_PREDICATES: Readonly<Record<string, RulePredicate>> = {
  "github-timing-safe-equal": githubTimingSafeEqualPredicate,
};
