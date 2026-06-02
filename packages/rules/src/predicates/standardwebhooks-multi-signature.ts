// 08.3 Plan 16b — Standard Webhooks multi-signature rotation rule (pagerduty-multi-signature analog).
//
// Standard Webhooks sends `webhook-signature: v1,<sig1> v1,<sig2>` — SPACE-separated signatures
// during a key rotation window (comma is INSIDE each `v1,<sig>` token; the separator between
// signatures is a space). A handler that only verifies the first token, or compares the whole
// header value as a single signature, silently rejects valid deliveries the moment a rotation
// begins, and tampered deliveries may slip through if only one token is checked.
//
// Heuristic (identical shape to pagerduty-multi-signature.ts): when manual HMAC verification IS
// reachable from a standardwebhooks handler but no iteration symbol (.split, .forEach, .map,
// .some, .every, explode, ...) is reachable, emit `manual-review`. Conservative by design — we
// surface for human review rather than `not-verified`, because some handlers iterate via
// constructs that don't appear in `reachable_symbols`.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import { isManualHmacEntry } from "./_helpers.js";

const ITERATION_SUFFIXES: ReadonlyArray<string> = [
  ".split",
  ".forEach",
  ".for_each",
  ".map",
  ".some",
  ".every",
  ".find",
  ".filter",
  ".any",
  ".all",
];

const ITERATION_BARE: ReadonlySet<string> = new Set([
  "split",
  "explode",
  "preg_split",
  "str_getcsv",
]);

function reachesIteration(handler: WebhookHandler): boolean {
  for (const s of handler.reachable_symbols) {
    const q = s.qualified_name;
    if (ITERATION_BARE.has(q)) return true;
    for (const suffix of ITERATION_SUFFIXES) {
      if (q.endsWith(suffix)) return true;
    }
  }
  return false;
}

export const standardwebhooksMultiSignatureRotationMishandledPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "standardwebhooks") return null;

  // Only fire when the handler is actually attempting manual HMAC. If verification hasn't been
  // attempted at all, standardwebhooks-missing-signature-verification is the right rule.
  if (!handler.reachable_symbols.some((s) => isManualHmacEntry(s.qualified_name))) {
    return null;
  }

  if (reachesIteration(handler)) return null;

  return "manual-review";
};
