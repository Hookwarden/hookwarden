// RULES-02 detection #3 (GitHub). The handler is "trying to verify" — it reads the
// `X-Hub-Signature-256` header OR calls the SDK verify — but evidence does not include
// `body_as_bytes_or_buffer`. GitHub's HMAC-SHA256 is computed over the raw payload, so any
// pre-parsed body (e.g. via `express.json()` mounted ahead of the webhook route) fails on
// every webhook delivery.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";

export const githubRawBodyMisusePredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "github") return null;
  const evidence = handler.evidence;
  if (evidence.some((e) => e.kind === "body_as_bytes_or_buffer")) return null;
  const isAttempting = evidence.some(
    (e) =>
      (e.kind === "signature_header_read" || e.kind === "sdk_verify_call") &&
      e.provider === "github",
  );
  if (!isAttempting) return null;
  return "not-verified";
};
