// RULES-02 detection #3, catalog-parameterized factory (D-90, D-91, D-93). The handler is
// "trying to verify" — it reads the provider's signature header OR calls the SDK verify — but
// evidence does not include `body_as_bytes_or_buffer`, meaning the body is being parsed as
// JSON before verification reads the raw bytes. HMAC is computed over the raw payload, so any
// pre-parsed body fails on every webhook delivery.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type {
  ProjectModel,
  ProviderCatalogEntry,
  RulePredicate,
  WebhookHandler,
} from "@hookwarden/engine";
import { PROVIDER_CATALOG } from "../catalog.js";

export function createRawBodyMisusePredicate(
  provider: string,
  _catalog: ProviderCatalogEntry,
): RulePredicate {
  return async (handler: WebhookHandler, _model: ProjectModel) => {
    if (handler.provider !== provider) return null;
    const evidence = handler.evidence;
    if (evidence.some((e) => e.kind === "body_as_bytes_or_buffer")) return null;
    const isAttempting = evidence.some(
      (e) =>
        (e.kind === "signature_header_read" || e.kind === "sdk_verify_call") &&
        e.provider === provider,
    );
    if (!isAttempting) return null;
    return "not-verified";
  };
}

export const stripeRawBodyMisusePredicate: RulePredicate = createRawBodyMisusePredicate(
  "stripe",
  PROVIDER_CATALOG["stripe"] ?? throwMissing("stripe"),
);

export const githubRawBodyMisusePredicate: RulePredicate = createRawBodyMisusePredicate(
  "github",
  PROVIDER_CATALOG["github"] ?? throwMissing("github"),
);

export const shopifyRawBodyMisusePredicate: RulePredicate = createRawBodyMisusePredicate(
  "shopify",
  PROVIDER_CATALOG["shopify"] ?? throwMissing("shopify"),
);

export const twilioRawBodyMisusePredicate: RulePredicate = createRawBodyMisusePredicate(
  "twilio",
  PROVIDER_CATALOG["twilio"] ?? throwMissing("twilio"),
);

export const slackRawBodyMisusePredicate: RulePredicate = createRawBodyMisusePredicate(
  "slack",
  PROVIDER_CATALOG["slack"] ?? throwMissing("slack"),
);

export const squareRawBodyMisusePredicate: RulePredicate = createRawBodyMisusePredicate(
  "square",
  PROVIDER_CATALOG["square"] ?? throwMissing("square"),
);

export const zendeskRawBodyMisusePredicate: RulePredicate = createRawBodyMisusePredicate(
  "zendesk",
  PROVIDER_CATALOG["zendesk"] ?? throwMissing("zendesk"),
);

export const intercomRawBodyMisusePredicate: RulePredicate = createRawBodyMisusePredicate(
  "intercom",
  PROVIDER_CATALOG["intercom"] ?? throwMissing("intercom"),
);

export const linearRawBodyMisusePredicate: RulePredicate = createRawBodyMisusePredicate(
  "linear",
  PROVIDER_CATALOG["linear"] ?? throwMissing("linear"),
);

export const docusignRawBodyMisusePredicate: RulePredicate = createRawBodyMisusePredicate(
  "docusign",
  PROVIDER_CATALOG["docusign"] ?? throwMissing("docusign"),
);

export const auth0RawBodyMisusePredicate: RulePredicate = createRawBodyMisusePredicate(
  "auth0",
  PROVIDER_CATALOG["auth0"] ?? throwMissing("auth0"),
);

export const hubspotRawBodyMisusePredicate: RulePredicate = createRawBodyMisusePredicate(
  "hubspot",
  PROVIDER_CATALOG["hubspot"] ?? throwMissing("hubspot"),
);

export const mailchimpRawBodyMisusePredicate: RulePredicate = createRawBodyMisusePredicate(
  "mailchimp",
  PROVIDER_CATALOG["mailchimp"] ?? throwMissing("mailchimp"),
);

export const standardwebhooksRawBodyMisusePredicate: RulePredicate = createRawBodyMisusePredicate(
  "standardwebhooks",
  PROVIDER_CATALOG["standardwebhooks"] ?? throwMissing("standardwebhooks"),
);

function throwMissing(provider: string): never {
  throw new Error(`PROVIDER_CATALOG entry for '${provider}' is missing`);
}
