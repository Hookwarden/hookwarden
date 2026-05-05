// RULES-02 detection #7, catalog-parameterized factory (D-90, D-91, D-93). The provider's SDK
// is imported in the handler's file but no SDK verify call (anchored to the catalog's
// sdk_packages list) is reachable from the handler entry point within the engine's bounded
// reachability budget (D-34). Verification might be conditional, dynamically dispatched, in
// dead code, or absent. Emit 'manual-review' so the user can inspect, rather than
// 'not-verified' which would create noise on legitimate-but-indirect verification patterns.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type {
  ProjectModel,
  ProviderCatalogEntry,
  RulePredicate,
  WebhookHandler,
} from "@hookwarden/engine";
import { PROVIDER_CATALOG } from "../catalog.js";
import { reachesSdkVerifyCall } from "./_helpers.js";

export function createUnreachableVerificationPredicate(
  provider: string,
  catalog: ProviderCatalogEntry,
): RulePredicate {
  return async (handler: WebhookHandler, _model: ProjectModel) => {
    if (handler.provider !== provider) return null;
    const sdkImported = handler.evidence.some(
      (e) => e.kind === "sdk_import" && e.provider === provider,
    );
    if (!sdkImported) return null;
    if (
      reachesSdkVerifyCall(
        handler.reachable_symbols,
        catalog.sdk_verify_calls,
        catalog.sdk_packages,
      )
    ) {
      return null;
    }
    return "manual-review";
  };
}

export const stripeUnreachableVerificationPredicate: RulePredicate =
  createUnreachableVerificationPredicate(
    "stripe",
    PROVIDER_CATALOG["stripe"] ?? throwMissing("stripe"),
  );

export const githubUnreachableVerificationPredicate: RulePredicate =
  createUnreachableVerificationPredicate(
    "github",
    PROVIDER_CATALOG["github"] ?? throwMissing("github"),
  );

export const shopifyUnreachableVerificationPredicate: RulePredicate =
  createUnreachableVerificationPredicate(
    "shopify",
    PROVIDER_CATALOG["shopify"] ?? throwMissing("shopify"),
  );

export const twilioUnreachableVerificationPredicate: RulePredicate =
  createUnreachableVerificationPredicate(
    "twilio",
    PROVIDER_CATALOG["twilio"] ?? throwMissing("twilio"),
  );

function throwMissing(provider: string): never {
  throw new Error(`PROVIDER_CATALOG entry for '${provider}' is missing`);
}
