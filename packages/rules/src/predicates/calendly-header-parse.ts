// 08.3 Plan 14 — Calendly comma-separated signature header parse rule.
//
// Calendly's signature header is `Calendly-Webhook-Signature: t=<unix>,v1=<hex>`
// (Stripe-shaped). The handler MUST parse the comma-separated components to
// extract the timestamp (`t=`) and the HMAC hex (`v1=`) before computing
// `HMAC-SHA256(${timestamp}.${rawBody})` and constant-time-comparing against
// the extracted hex.
//
// Real bug patterns this rule catches:
//   - Handler compares the full `t=...,v1=...` header value against a bare
//     HMAC hex digest — fails every delivery.
//   - Handler computes HMAC over the raw body alone (forgetting the
//     `${timestamp}.` prefix) — fails every delivery.
//   - Handler reads the header but never split-parses it — the v1 hex it
//     compares against is wrong or undefined.
//
// Heuristic: Calendly handler + manual HMAC reachable + signature_header_read
// evidence present + NO string-manipulation symbol (.split / .forEach /
// .substring / .replace / .startsWith / .indexOf / strpos / substr /
// str_replace / preg_split / explode) reachable → manual-review.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import { isManualHmacEntry } from "./_helpers.js";

const HEADER_PARSE_SUFFIXES: ReadonlyArray<string> = [
  ".split",
  ".substring",
  ".substr",
  ".slice",
  ".replace",
  ".replaceAll",
  ".startsWith",
  ".indexOf",
  ".match",
  ".forEach",
  ".for_each",
  ".map",
  ".find",
];

const HEADER_PARSE_BARE: ReadonlySet<string> = new Set([
  "split",
  "explode",
  "preg_split",
  "preg_match",
  "str_getcsv",
  "substr",
  "substring",
  "strpos",
  "str_replace",
]);

function reachesHeaderParsing(handler: WebhookHandler): boolean {
  for (const s of handler.reachable_symbols) {
    const q = s.qualified_name;
    if (HEADER_PARSE_BARE.has(q)) return true;
    for (const suffix of HEADER_PARSE_SUFFIXES) {
      if (q.endsWith(suffix)) return true;
    }
  }
  return false;
}

export const calendlySignatureHeaderParseMishandledPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "calendly") return null;

  if (!handler.reachable_symbols.some((s) => isManualHmacEntry(s.qualified_name))) return null;

  if (!handler.evidence.some((e) => e.kind === "signature_header_read")) return null;

  if (reachesHeaderParsing(handler)) return null;

  return "manual-review";
};
