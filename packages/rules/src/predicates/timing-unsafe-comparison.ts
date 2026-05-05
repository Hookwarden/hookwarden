// RULES-02 detection #2, catalog-parameterized factory (D-90, D-91, D-93). Manual HMAC path is
// reachable but a constant-time comparison (`crypto.timingSafeEqual` / `hmac.compare_digest`)
// is not — the handler is rolling its own equality check, leaking timing information.
//
// SDK path is exempt — the SDK handles comparison internally.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type {
  ProjectModel,
  ProviderCatalogEntry,
  RulePredicate,
  WebhookHandler,
} from "@hookwarden/engine";
import { PROVIDER_CATALOG } from "../catalog.js";
import { isConstantTimeCompare, isManualHmacEntry, reachesSdkVerifyCall } from "./_helpers.js";

export function createTimingUnsafeComparisonPredicate(
  provider: string,
  catalog: ProviderCatalogEntry,
): RulePredicate {
  return async (handler: WebhookHandler, _model: ProjectModel) => {
    if (handler.provider !== provider) return null;
    const symbols = handler.reachable_symbols;
    if (reachesSdkVerifyCall(symbols, catalog.sdk_verify_calls, catalog.sdk_packages)) return null;
    if (!symbols.some((s) => isManualHmacEntry(s.qualified_name))) return null;
    if (symbols.some((s) => isConstantTimeCompare(s.qualified_name))) return null;
    return "not-verified";
  };
}

export const stripeTimingUnsafeComparisonPredicate: RulePredicate =
  createTimingUnsafeComparisonPredicate(
    "stripe",
    PROVIDER_CATALOG["stripe"] ?? throwMissing("stripe"),
  );

export const githubTimingUnsafeComparisonPredicate: RulePredicate =
  createTimingUnsafeComparisonPredicate(
    "github",
    PROVIDER_CATALOG["github"] ?? throwMissing("github"),
  );

function throwMissing(provider: string): never {
  throw new Error(`PROVIDER_CATALOG entry for '${provider}' is missing`);
}
