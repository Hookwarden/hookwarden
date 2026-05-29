// 08.3 Plan 11 — PagerDuty multi-signature rotation rule.
//
// PagerDuty v3 webhooks send `X-PagerDuty-Signature: v1=<hex>,v1=<hex>,...` where
// multiple comma-separated signatures appear during a key rotation window. A handler
// that only verifies the first token (or that compares the whole header value as a
// single signature) silently rejects valid deliveries the moment PagerDuty starts a
// rotation, and tampered deliveries during rotation may slip through if only one of
// the tokens is checked.
//
// Heuristic: when manual HMAC verification IS reachable from a PagerDuty handler but
// no comma-iteration symbol (.split, .forEach, .map, .some, .every, .find, explode)
// is reachable, emit `manual-review`. This is intentionally conservative — we surface
// the case for human review rather than emitting `not-verified`, because some handlers
// iterate via constructs that don't appear in `reachable_symbols`.
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

function reachesCommaIteration(handler: WebhookHandler): boolean {
  for (const s of handler.reachable_symbols) {
    const q = s.qualified_name;
    if (ITERATION_BARE.has(q)) return true;
    for (const suffix of ITERATION_SUFFIXES) {
      if (q.endsWith(suffix)) return true;
    }
  }
  return false;
}

export const pagerdutyMultiSignatureRotationMishandledPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "pagerduty") return null;

  // Only fire when the handler is actually attempting manual HMAC. If verification
  // hasn't been attempted, missing-signature-verification is the right rule.
  if (!handler.reachable_symbols.some((s) => isManualHmacEntry(s.qualified_name))) {
    return null;
  }

  if (reachesCommaIteration(handler)) return null;

  return "manual-review";
};
