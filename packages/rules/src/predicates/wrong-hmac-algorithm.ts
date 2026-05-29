// RULES-02 detection #5, catalog-parameterized factory (D-90, D-91, D-93). The provider's
// expected HMAC algorithm comes from `catalog.hmac_algorithm`; symbols matching the wrong
// algorithm hint at a misconfigured handler. WR-01 (preserved verbatim from the GitHub
// pre-Phase-6 predicate): when BOTH expected AND wrong algorithm symbols are reachable,
// emit 'manual-review' rather than false-flag — the handler could be using the expected
// algorithm for HMAC and a wrong-but-irrelevant algorithm for an unrelated ETag. Three-state
// preservation per D-29 + PITFALLS §3.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type {
  ProjectModel,
  ProviderCatalogEntry,
  RulePredicate,
  WebhookHandler,
} from "@hookwarden/engine";
import { PROVIDER_CATALOG } from "../catalog.js";
import { isManualHmacEntry } from "./_helpers.js";

const ALL_ALGO_HINTS: ReadonlyArray<string> = [
  ".md5",
  ".sha1",
  ".sha256",
  ".sha384",
  ".sha512",
  ".ripemd160",
];

function endsWithAny(name: string, suffixes: ReadonlyArray<string>): boolean {
  for (const s of suffixes) {
    if (name.endsWith(s)) return true;
  }
  return false;
}

export function createWrongHmacAlgorithmPredicate(
  provider: string,
  catalog: ProviderCatalogEntry,
): RulePredicate {
  const expected = `.${catalog.hmac_algorithm}`;
  const expectedHints: ReadonlyArray<string> = [expected];
  const wrongHints: ReadonlyArray<string> = ALL_ALGO_HINTS.filter((h) => h !== expected);

  return async (handler: WebhookHandler, _model: ProjectModel) => {
    if (handler.provider !== provider) return null;
    const symbols = handler.reachable_symbols;
    if (!symbols.some((s) => isManualHmacEntry(s.qualified_name))) return null;
    const hasWrong = symbols.some((s) => endsWithAny(s.qualified_name, wrongHints));
    const hasExpected = symbols.some((s) => endsWithAny(s.qualified_name, expectedHints));
    // WR-01: ambiguous — both algorithms reachable. Cannot statically tell which feeds HMAC.
    if (hasExpected && hasWrong) return "manual-review";
    if (hasWrong) return "not-verified";
    if (hasExpected) return null;
    // Manual HMAC reachable but algorithm undetermined — surface for human review.
    return "manual-review";
  };
}

export const stripeWrongHmacAlgorithmPredicate: RulePredicate = createWrongHmacAlgorithmPredicate(
  "stripe",
  PROVIDER_CATALOG["stripe"] ?? throwMissing("stripe"),
);

export const githubWrongHmacAlgorithmPredicate: RulePredicate = createWrongHmacAlgorithmPredicate(
  "github",
  PROVIDER_CATALOG["github"] ?? throwMissing("github"),
);

export const shopifyWrongHmacAlgorithmPredicate: RulePredicate = createWrongHmacAlgorithmPredicate(
  "shopify",
  PROVIDER_CATALOG["shopify"] ?? throwMissing("shopify"),
);

export const twilioWrongHmacAlgorithmPredicate: RulePredicate = createWrongHmacAlgorithmPredicate(
  "twilio",
  PROVIDER_CATALOG["twilio"] ?? throwMissing("twilio"),
);

export const slackWrongHmacAlgorithmPredicate: RulePredicate = createWrongHmacAlgorithmPredicate(
  "slack",
  PROVIDER_CATALOG["slack"] ?? throwMissing("slack"),
);

export const squareWrongHmacAlgorithmPredicate: RulePredicate = createWrongHmacAlgorithmPredicate(
  "square",
  PROVIDER_CATALOG["square"] ?? throwMissing("square"),
);

export const zendeskWrongHmacAlgorithmPredicate: RulePredicate = createWrongHmacAlgorithmPredicate(
  "zendesk",
  PROVIDER_CATALOG["zendesk"] ?? throwMissing("zendesk"),
);

export const intercomWrongHmacAlgorithmPredicate: RulePredicate = createWrongHmacAlgorithmPredicate(
  "intercom",
  PROVIDER_CATALOG["intercom"] ?? throwMissing("intercom"),
);

export const linearWrongHmacAlgorithmPredicate: RulePredicate = createWrongHmacAlgorithmPredicate(
  "linear",
  PROVIDER_CATALOG["linear"] ?? throwMissing("linear"),
);

export const docusignWrongHmacAlgorithmPredicate: RulePredicate = createWrongHmacAlgorithmPredicate(
  "docusign",
  PROVIDER_CATALOG["docusign"] ?? throwMissing("docusign"),
);

export const auth0WrongHmacAlgorithmPredicate: RulePredicate = createWrongHmacAlgorithmPredicate(
  "auth0",
  PROVIDER_CATALOG["auth0"] ?? throwMissing("auth0"),
);

export const sentryWrongHmacAlgorithmPredicate: RulePredicate = createWrongHmacAlgorithmPredicate(
  "sentry",
  PROVIDER_CATALOG["sentry"] ?? throwMissing("sentry"),
);

export const pagerdutyWrongHmacAlgorithmPredicate: RulePredicate =
  createWrongHmacAlgorithmPredicate(
    "pagerduty",
    PROVIDER_CATALOG["pagerduty"] ?? throwMissing("pagerduty"),
  );

export const bitbucketWrongHmacAlgorithmPredicate: RulePredicate =
  createWrongHmacAlgorithmPredicate(
    "bitbucket",
    PROVIDER_CATALOG["bitbucket"] ?? throwMissing("bitbucket"),
  );

export const notionWrongHmacAlgorithmPredicate: RulePredicate = createWrongHmacAlgorithmPredicate(
  "notion",
  PROVIDER_CATALOG["notion"] ?? throwMissing("notion"),
);

export const calendlyWrongHmacAlgorithmPredicate: RulePredicate =
  createWrongHmacAlgorithmPredicate(
    "calendly",
    PROVIDER_CATALOG["calendly"] ?? throwMissing("calendly"),
  );

export const zoomWrongHmacAlgorithmPredicate: RulePredicate = createWrongHmacAlgorithmPredicate(
  "zoom",
  PROVIDER_CATALOG["zoom"] ?? throwMissing("zoom"),
);

export const hubspotWrongHmacAlgorithmPredicate: RulePredicate = createWrongHmacAlgorithmPredicate(
  "hubspot",
  PROVIDER_CATALOG["hubspot"] ?? throwMissing("hubspot"),
);

export const standardwebhooksWrongHmacAlgorithmPredicate: RulePredicate =
  createWrongHmacAlgorithmPredicate(
    "standardwebhooks",
    PROVIDER_CATALOG["standardwebhooks"] ?? throwMissing("standardwebhooks"),
  );

function throwMissing(provider: string): never {
  throw new Error(`PROVIDER_CATALOG entry for '${provider}' is missing`);
}
