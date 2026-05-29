// 08.3 Plan 15 — Zoom url-validation-only rule.
//
// Zoom's webhook setup uses a two-phase model:
//   1. Initial URL validation: Zoom sends an `endpoint.url_validation` event
//      with a `plainToken`; the handler must respond with the HMAC-SHA256
//      hash of the token to prove ownership.
//   2. Runtime events: every subsequent payload is signed under
//      `X-Zm-Signature: v0=<hex>` with HMAC over `v0:${X-Zm-Request-Timestamp}:${rawBody}`.
//
// The bug pattern: handlers that pass the initial URL validation
// (echoing the HMAC of the plainToken) but never verify the
// `X-Zm-Signature` header on subsequent runtime events. Zoom enables the
// webhook subscription on the URL-validation success, then quietly accepts
// every event thereafter without signature verification.
//
// Heuristic mirrors Notion's verification-token-only: Zoom-attributed
// handler + `signature_header_read` evidence present (handler IS reading
// X-Zm-Signature) + NO manual HMAC reachable → manual-review.
//
// Conservative (manual-review, not not-verified) because handlers could
// be verifying via paths the engine doesn't surface as evidence.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import { isManualHmacEntry } from "./_helpers.js";

export const zoomUrlValidationOnlyPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "zoom") return null;

  // Only fire when the handler IS reading the signature header. If no
  // signature_header_read evidence is present, missing-signature-verification
  // covers that case as not-verified.
  if (!handler.evidence.some((e) => e.kind === "signature_header_read")) return null;

  // If manual HMAC is reachable, the handler is actually verifying.
  if (handler.reachable_symbols.some((s) => isManualHmacEntry(s.qualified_name))) return null;

  return "manual-review";
};
