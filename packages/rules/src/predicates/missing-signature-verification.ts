// RULES-02 detection #1, catalog-parameterized factory (D-90, D-91, D-92, D-93). Emits
// not-verified when neither the provider's SDK verify call nor a manual HMAC entry-point
// is reachable from the handler within the engine's bounded reachability budget (D-34).
// Conservative: defers (returns null) when EITHER path is reachable — other rules cover the
// manual-HMAC sub-cases (timing-unsafe, missing-timestamp, wrong-algo) and library-verified
// covers the SDK case.
//
// D-92 custom-signing slot: when `catalog.signing_input_format === 'custom'`, dispatch to a
// provider-specific predicate registered in CUSTOM_SIGNING_PREDICATES (e.g. Twilio's
// URL+sorted-params canonical-string scheme lands in plan 06.3 at predicates/custom/twilio-
// signing.ts and registers itself there). When no custom predicate is registered for the
// provider, return null — defer to other rules rather than false-flag.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type {
  ProjectModel,
  ProviderCatalogEntry,
  RulePredicate,
  WebhookHandler,
} from "@hookwarden/engine";
import { PROVIDER_CATALOG } from "../catalog.js";
import { isManualHmacEntry, reachesSdkVerifyCall } from "./_helpers.js";

// D-92 registry. Custom-signing predicate files under predicates/custom/<provider>-signing.ts
// register their predicate here at module-load time (side-effect import). When a provider's
// catalog uses signing_input_format: 'custom' but no predicate is registered, the dispatch
// returns null — deferred until the predicate lands.
export const CUSTOM_SIGNING_PREDICATES: Record<string, RulePredicate> = {};

export function createMissingSignatureVerificationPredicate(
  provider: string,
  catalog: ProviderCatalogEntry,
): RulePredicate {
  return async (handler: WebhookHandler, model: ProjectModel) => {
    if (handler.provider !== provider) return null;
    const symbols = handler.reachable_symbols;

    if (catalog.signing_input_format === "custom") {
      const custom = CUSTOM_SIGNING_PREDICATES[provider];
      if (custom !== undefined) return custom(handler, model);
      return null;
    }

    if (reachesSdkVerifyCall(symbols, catalog.sdk_verify_calls, catalog.sdk_packages)) {
      return null;
    }
    if (symbols.some((s) => isManualHmacEntry(s.qualified_name))) return null;
    return "not-verified";
  };
}

export const stripeMissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "stripe",
    PROVIDER_CATALOG["stripe"] ?? throwMissing("stripe"),
  );

export const githubMissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "github",
    PROVIDER_CATALOG["github"] ?? throwMissing("github"),
  );

export const shopifyMissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "shopify",
    PROVIDER_CATALOG["shopify"] ?? throwMissing("shopify"),
  );

function throwMissing(provider: string): never {
  throw new Error(`PROVIDER_CATALOG entry for '${provider}' is missing`);
}
