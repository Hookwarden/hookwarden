// RULES-02 detection #4, catalog-parameterized factory (D-90, D-91, D-93). When manual HMAC
// is detected and no timestamp-related symbol (`Date.now`, `time.time`, `datetime.utcnow`,
// etc.) is reachable, the rule cannot statically verify replay defense — emits 'manual-review'
// per D-29 graded-confidence policy. SDK path is exempt.
//
// Catalog-driven semantics (D-91 timestamp_header):
//   - timestamp_header === null: provider embeds the timestamp inside the signature header
//     (Stripe pattern) OR relies on application-side dedupe (GitHub X-GitHub-Delivery UUIDs).
//     Predicate behavior matches the pre-Phase-6 Stripe + GitHub semantics: emit
//     'manual-review' when manual HMAC reachable AND no timestamp symbol is reachable.
//   - timestamp_header !== null: provider sends the timestamp as a separate request header
//     (Slack `x-slack-request-timestamp`, Square `x-square-hmacsha256-timestamp`, etc.). The
//     handler MUST extract that header and gate it by a tolerance window. Predicate fires
//     'manual-review' when manual HMAC reachable AND no timestamp comparison symbol is
//     reachable. (We use 'manual-review' rather than 'not-verified' because absence of the
//     symbol is necessary-but-not-sufficient evidence of a missing tolerance — the handler
//     could read the header and compare without using a recognized symbol; see D-29.)
//
// Pure: no fs / http / network / process / node:* (D-28).

import type {
  ProjectModel,
  ProviderCatalogEntry,
  RulePredicate,
  WebhookHandler,
} from "@hookwarden/engine";
import { PROVIDER_CATALOG } from "../catalog.js";
import { isManualHmacEntry, isTimestampSymbol, reachesSdkVerifyCall } from "./_helpers.js";

export function createMissingTimestampCheckPredicate(
  provider: string,
  catalog: ProviderCatalogEntry,
): RulePredicate {
  return async (handler: WebhookHandler, _model: ProjectModel) => {
    if (handler.provider !== provider) return null;
    const symbols = handler.reachable_symbols;
    if (reachesSdkVerifyCall(symbols, catalog.sdk_verify_calls, catalog.sdk_packages)) return null;
    if (!symbols.some((s) => isManualHmacEntry(s.qualified_name))) return null;
    if (symbols.some((s) => isTimestampSymbol(s.qualified_name))) return null;
    return "manual-review";
  };
}

export const stripeMissingTimestampCheckPredicate: RulePredicate =
  createMissingTimestampCheckPredicate(
    "stripe",
    PROVIDER_CATALOG["stripe"] ?? throwMissing("stripe"),
  );

export const githubMissingTimestampCheckPredicate: RulePredicate =
  createMissingTimestampCheckPredicate(
    "github",
    PROVIDER_CATALOG["github"] ?? throwMissing("github"),
  );

export const shopifyMissingTimestampCheckPredicate: RulePredicate =
  createMissingTimestampCheckPredicate(
    "shopify",
    PROVIDER_CATALOG["shopify"] ?? throwMissing("shopify"),
  );

export const twilioMissingTimestampCheckPredicate: RulePredicate =
  createMissingTimestampCheckPredicate(
    "twilio",
    PROVIDER_CATALOG["twilio"] ?? throwMissing("twilio"),
  );

export const slackMissingTimestampCheckPredicate: RulePredicate =
  createMissingTimestampCheckPredicate("slack", PROVIDER_CATALOG["slack"] ?? throwMissing("slack"));

export const zendeskMissingTimestampCheckPredicate: RulePredicate =
  createMissingTimestampCheckPredicate(
    "zendesk",
    PROVIDER_CATALOG["zendesk"] ?? throwMissing("zendesk"),
  );

function throwMissing(provider: string): never {
  throw new Error(`PROVIDER_CATALOG entry for '${provider}' is missing`);
}
