// RULES-02 detection #4 (Stripe). When manual HMAC path is detected and no timestamp-related
// symbol (`Date.now`, `time.time`, `datetime.utcnow`, etc.) is reachable, the rule cannot
// statically verify replay defense — emits 'manual-review' per D-29 graded-confidence policy.
//
// SDK path (`stripe.webhooks.constructEvent`) is exempt: it enforces a 300-second tolerance
// internally. The engine cannot statically extract Stripe-Signature `t=` argument values without
// taint analysis (deferred to v1.x per Phase 2 D-26), so we surface manual-review rather than
// false-positive not-verified.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";

const STRIPE_SDK_VERIFY: ReadonlySet<string> = new Set([
  "webhooks.constructEvent",
  "Webhook.constructEvent",
  "Webhook.construct_event",
]);

const TIMESTAMP_SYMBOLS: ReadonlyArray<string> = [
  "Date.now",
  "Date.parse",
  "time.time",
  "time.monotonic",
  "datetime.utcnow",
  "datetime.now",
];

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

function isTimestampSymbol(name: string): boolean {
  for (const t of TIMESTAMP_SYMBOLS) {
    if (name === t || name.endsWith(`.${t}`)) return true;
  }
  return false;
}

export const stripeMissingTimestampCheckPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "stripe") return null;
  const symbols = handler.reachable_symbols;
  if (symbols.some((s) => isStripeSdkVerify(s.qualified_name))) return null;
  if (!symbols.some((s) => isManualHmacEntry(s.qualified_name))) return null;
  if (symbols.some((s) => isTimestampSymbol(s.qualified_name))) return null;
  return "manual-review";
};
