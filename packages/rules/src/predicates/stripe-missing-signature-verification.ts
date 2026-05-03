// RULES-02 detection #1 (Stripe). Emits not-verified when neither the Stripe SDK verify call nor a
// manual HMAC path is reachable from the handler within the engine's bounded-depth reachability
// (D-34, default 3 hops). Conservative: defers (returns null) when EITHER path is reachable —
// other Stripe rules (timing-unsafe, missing-timestamp, wrong-algo) cover the manual-HMAC sub-cases
// and stripe-library-verified covers the SDK case.
//
// Pure: no fs / http / network / process / node:*. Required by .dependency-cruiser.cjs
// rules-predicates-no-node-core + rules-predicates-no-network-libs (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";

const STRIPE_SDK_VERIFY: ReadonlySet<string> = new Set([
  "webhooks.constructEvent",
  "Webhook.constructEvent",
  "Webhook.construct_event",
]);

function reachesAny(handler: WebhookHandler, names: ReadonlySet<string>): boolean {
  for (const sym of handler.reachable_symbols) {
    if (names.has(sym.qualified_name)) return true;
    for (const name of names) {
      if (sym.qualified_name.endsWith(`.${name}`)) return true;
    }
  }
  return false;
}

function reachesManualHmacEntry(handler: WebhookHandler): boolean {
  return handler.reachable_symbols.some(
    (s) =>
      s.qualified_name === "crypto.createHmac" ||
      s.qualified_name.endsWith(".createHmac") ||
      // Python stdlib manual HMAC entry point — without this the canonical Python pattern
      // (`hmac.new(secret, msg, hashlib.sha256)`) wouldn't register as a manual HMAC path.
      s.qualified_name === "hmac.new" ||
      s.qualified_name.endsWith(".hmac.new"),
  );
}

export const stripeMissingSignatureVerificationPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "stripe") return null;
  if (reachesAny(handler, STRIPE_SDK_VERIFY)) return null;
  if (reachesManualHmacEntry(handler)) return null;
  return "not-verified";
};
