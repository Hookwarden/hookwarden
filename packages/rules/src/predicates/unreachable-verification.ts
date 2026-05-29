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
    // Path B (parity with library-verified-recognition + missing-signature-verification) —
    // `sdk_verify_call` evidence emitted by build.ts overlays (PHP overlay + inline-middleware
    // verify overlay). Without this branch, JS/TS handlers whose verification lives in an
    // inline route-arg arrow get flagged manual-review even though library-verified found it.
    if (handler.evidence.some((e) => e.kind === "sdk_verify_call" && e.provider === provider)) {
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

export const slackUnreachableVerificationPredicate: RulePredicate =
  createUnreachableVerificationPredicate(
    "slack",
    PROVIDER_CATALOG["slack"] ?? throwMissing("slack"),
  );

export const squareUnreachableVerificationPredicate: RulePredicate =
  createUnreachableVerificationPredicate(
    "square",
    PROVIDER_CATALOG["square"] ?? throwMissing("square"),
  );

export const zendeskUnreachableVerificationPredicate: RulePredicate =
  createUnreachableVerificationPredicate(
    "zendesk",
    PROVIDER_CATALOG["zendesk"] ?? throwMissing("zendesk"),
  );

export const intercomUnreachableVerificationPredicate: RulePredicate =
  createUnreachableVerificationPredicate(
    "intercom",
    PROVIDER_CATALOG["intercom"] ?? throwMissing("intercom"),
  );

export const linearUnreachableVerificationPredicate: RulePredicate =
  createUnreachableVerificationPredicate(
    "linear",
    PROVIDER_CATALOG["linear"] ?? throwMissing("linear"),
  );

export const docusignUnreachableVerificationPredicate: RulePredicate =
  createUnreachableVerificationPredicate(
    "docusign",
    PROVIDER_CATALOG["docusign"] ?? throwMissing("docusign"),
  );

export const auth0UnreachableVerificationPredicate: RulePredicate =
  createUnreachableVerificationPredicate(
    "auth0",
    PROVIDER_CATALOG["auth0"] ?? throwMissing("auth0"),
  );

export const datadogUnreachableVerificationPredicate: RulePredicate =
  createUnreachableVerificationPredicate(
    "datadog",
    PROVIDER_CATALOG["datadog"] ?? throwMissing("datadog"),
  );

export const sentryUnreachableVerificationPredicate: RulePredicate =
  createUnreachableVerificationPredicate(
    "sentry",
    PROVIDER_CATALOG["sentry"] ?? throwMissing("sentry"),
  );

export const pagerdutyUnreachableVerificationPredicate: RulePredicate =
  createUnreachableVerificationPredicate(
    "pagerduty",
    PROVIDER_CATALOG["pagerduty"] ?? throwMissing("pagerduty"),
  );

export const bitbucketUnreachableVerificationPredicate: RulePredicate =
  createUnreachableVerificationPredicate(
    "bitbucket",
    PROVIDER_CATALOG["bitbucket"] ?? throwMissing("bitbucket"),
  );

export const notionUnreachableVerificationPredicate: RulePredicate =
  createUnreachableVerificationPredicate(
    "notion",
    PROVIDER_CATALOG["notion"] ?? throwMissing("notion"),
  );

export const hubspotUnreachableVerificationPredicate: RulePredicate =
  createUnreachableVerificationPredicate(
    "hubspot",
    PROVIDER_CATALOG["hubspot"] ?? throwMissing("hubspot"),
  );

export const mailchimpUnreachableVerificationPredicate: RulePredicate =
  createUnreachableVerificationPredicate(
    "mailchimp",
    PROVIDER_CATALOG["mailchimp"] ?? throwMissing("mailchimp"),
  );

export const postmarkUnreachableVerificationPredicate: RulePredicate =
  createUnreachableVerificationPredicate(
    "postmark",
    PROVIDER_CATALOG["postmark"] ?? throwMissing("postmark"),
  );

export const standardwebhooksUnreachableVerificationPredicate: RulePredicate =
  createUnreachableVerificationPredicate(
    "standardwebhooks",
    PROVIDER_CATALOG["standardwebhooks"] ?? throwMissing("standardwebhooks"),
  );

function throwMissing(provider: string): never {
  throw new Error(`PROVIDER_CATALOG entry for '${provider}' is missing`);
}
