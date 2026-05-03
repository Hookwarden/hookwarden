// RULES-02 detection #2 (Stripe). Manual HMAC path is reachable but a constant-time comparison
// (`crypto.timingSafeEqual` / `hmac.compare_digest`) is not — the handler is rolling its own
// signature equality check with `==` / `===` on the buffer, which leaks timing information.
//
// SDK path (`stripe.webhooks.constructEvent`) is exempt — the SDK handles comparison internally.
//
// B-2: Python parity. `hmac.new(...)` is the Python stdlib manual HMAC entry; without it the
// canonical Python timing-unsafe pattern (`expected = hmac.new(...).hexdigest(); if expected == sig`)
// wouldn't be detected by the predicate.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";

const STRIPE_SDK_VERIFY: ReadonlySet<string> = new Set([
  "webhooks.constructEvent",
  "Webhook.constructEvent",
  "Webhook.construct_event",
]);

function isStripeSdkVerify(name: string): boolean {
  if (STRIPE_SDK_VERIFY.has(name)) return true;
  for (const v of STRIPE_SDK_VERIFY) {
    if (name.endsWith(`.${v}`)) return true;
  }
  return false;
}

function isManualHmacEntry(name: string): boolean {
  return (
    name === "crypto.createHmac" ||
    name.endsWith(".createHmac") ||
    name === "hmac.new" ||
    name.endsWith(".hmac.new")
  );
}

function isConstantTimeCompare(name: string): boolean {
  return (
    name === "crypto.timingSafeEqual" ||
    name.endsWith(".timingSafeEqual") ||
    name === "hmac.compare_digest" ||
    name.endsWith(".compare_digest")
  );
}

export const stripeTimingUnsafeComparisonPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "stripe") return null;
  const symbols = handler.reachable_symbols;
  if (symbols.some((s) => isStripeSdkVerify(s.qualified_name))) return null;
  if (!symbols.some((s) => isManualHmacEntry(s.qualified_name))) return null;
  if (symbols.some((s) => isConstantTimeCompare(s.qualified_name))) return null;
  return "not-verified";
};
