// RULES-02 detection #7 (Stripe). The Stripe SDK is imported in the handler's file but no
// `constructEvent` call is reachable from the handler entry point within the engine's bounded
// reachability budget (D-34). Verification might be conditional, dynamically dispatched, in dead
// code, or simply absent. Emit 'manual-review' so the user can inspect, rather than 'not-verified'
// which would create noise on legitimate-but-indirect verification patterns.
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

export const stripeUnreachableVerificationPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "stripe") return null;
  const stripeImported = handler.evidence.some(
    (e) => e.kind === "sdk_import" && e.provider === "stripe",
  );
  if (!stripeImported) return null;
  if (handler.reachable_symbols.some((s) => isStripeSdkVerify(s.qualified_name))) return null;
  return "manual-review";
};
