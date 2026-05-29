// 08.3 Plan 13 — Notion verification-token-only rule.
//
// Notion's webhook setup uses a two-phase model:
//   1. Initial verification: Notion sends a `verification_token` in the body;
//      the handler echoes it back as the response to prove ownership.
//   2. Runtime events: Notion signs each subsequent payload with HMAC-SHA256
//      hex under `X-Notion-Signature` — handlers MUST verify the signature.
//
// The bug pattern this rule catches: handlers that read `X-Notion-Signature`
// (or otherwise look like they're authenticating requests) but never compute
// HMAC. The handler may be comparing the signature header against a stored
// verification token, or simply trusting any well-formed signature header
// without verifying it.
//
// Heuristic: Notion-attributed handler + signature_header_read evidence
// (engine evidence fires when the handler reads catalog.signature_header =
// `x-notion-signature`) + NO manual HMAC reachable → manual-review.
//
// Conservative (manual-review, not not-verified) because handlers could be
// verifying via a path that doesn't surface in reachable_symbols.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import { isManualHmacEntry } from "./_helpers.js";

export const notionVerificationTokenOnlyPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "notion") return null;

  // Only fire when the handler IS reading the signature header. If no
  // signature_header_read evidence is present, missing-signature-verification
  // (via the custom slot) covers that case as not-verified.
  if (!handler.evidence.some((e) => e.kind === "signature_header_read")) return null;

  // If manual HMAC is reachable, the handler is actually verifying.
  if (handler.reachable_symbols.some((s) => isManualHmacEntry(s.qualified_name))) return null;

  return "manual-review";
};
