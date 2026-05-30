// 08.3 Plan 13 — Notion custom-signing slot (D-92).
//
// Notion's webhook integration uses a verification-token model on initial setup
// (the handler must echo a `verification_token` field) plus signed-payload
// verification thereafter (HMAC-SHA256 hex over the raw body, under
// `X-Notion-Signature`). The catalog ships `signing_input_format: 'custom'`
// so the missing-signature-verification factory dispatches here.
//
// This custom slot answers the coarse "did the handler attempt ANY signature
// verification path?" question. It returns null when EITHER:
//   - manual HMAC is reachable from the handler entry, OR
//   - signature_header_read evidence is present (handler is reading
//     X-Notion-Signature) — leaves the other rules (raw-body-misuse,
//     verification-token-only, timing-unsafe-comparison, etc.) to grade the
//     specifics.
// Otherwise it returns `not-verified`.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import { isManualHmacEntry } from "../_helpers.js";
import { CUSTOM_SIGNING_PREDICATES } from "../missing-signature-verification.js";

const notionSigningPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "notion") return null;

  if (handler.reachable_symbols.some((s) => isManualHmacEntry(s.qualified_name))) return null;
  if (handler.evidence.some((e) => e.kind === "signature_header_read")) return null;

  return "not-verified";
};

CUSTOM_SIGNING_PREDICATES["notion"] = notionSigningPredicate;
