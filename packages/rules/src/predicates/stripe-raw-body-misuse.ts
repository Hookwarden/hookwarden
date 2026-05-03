// RULES-02 detection #3 (Stripe). The handler is "trying to verify" — it reads the Stripe
// signature header OR calls the SDK verify — but evidence does not include
// `body_as_bytes_or_buffer`, meaning the body is being parsed as JSON before verification reads
// the raw bytes. Stripe's HMAC is computed over the raw payload, so any pre-parsed body fails
// verification on every webhook.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";

export const stripeRawBodyMisusePredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "stripe") return null;
  const evidence = handler.evidence;
  if (evidence.some((e) => e.kind === "body_as_bytes_or_buffer")) return null;
  const isAttempting = evidence.some(
    (e) =>
      (e.kind === "signature_header_read" || e.kind === "sdk_verify_call") &&
      e.provider === "stripe",
  );
  if (!isAttempting) return null;
  return "not-verified";
};
