// 08.3 Plan 12 — Bitbucket signature-prefix-not-stripped rule.
//
// Bitbucket Cloud (like GitHub legacy) sends the `X-Hub-Signature` value as
// `sha256=<hex>` — the `sha256=` prefix MUST be stripped before comparing
// against a bare HMAC hex digest. A handler that compares the full header
// value against `crypto.createHmac('sha256', secret).update(rawBody).digest('hex')`
// silently rejects every delivery (the prefix is never going to match the
// digest output).
//
// Heuristic: when manual HMAC is reachable from a Bitbucket handler AND
// signature_header_read evidence is present (so the handler IS reading the
// header) BUT no string-manipulation symbol that could strip the prefix is
// reachable (.substring / .substr / .slice / .replace / .replaceAll / .split /
// .startsWith / .indexOf / strpos / substr / str_replace / preg_replace /
// ltrim / Buffer.from), emit manual-review. Conservative: many handlers strip
// the prefix via constructs that don't surface in reachable_symbols, so we
// surface for review rather than emit not-verified.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import { isManualHmacEntry } from "./_helpers.js";

const PREFIX_PARSE_SUFFIXES: ReadonlyArray<string> = [
  ".substring",
  ".substr",
  ".slice",
  ".replace",
  ".replaceAll",
  ".replace_all",
  ".split",
  ".startsWith",
  ".starts_with",
  ".indexOf",
  ".lstrip",
  ".trim",
  ".trimStart",
];

const PREFIX_PARSE_BARE: ReadonlySet<string> = new Set([
  "substr",
  "substring",
  "split",
  "explode",
  "strpos",
  "str_replace",
  "preg_replace",
  "preg_match",
  "ltrim",
  "trim",
]);

function reachesPrefixStripping(handler: WebhookHandler): boolean {
  for (const s of handler.reachable_symbols) {
    const q = s.qualified_name;
    if (PREFIX_PARSE_BARE.has(q)) return true;
    for (const suffix of PREFIX_PARSE_SUFFIXES) {
      if (q.endsWith(suffix)) return true;
    }
  }
  return false;
}

export const bitbucketSignaturePrefixNotStrippedPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "bitbucket") return null;

  // Only fire when the handler is actually verifying. (missing-signature-verification
  // and raw-body-misuse cover the no-verification cases.)
  if (!handler.reachable_symbols.some((s) => isManualHmacEntry(s.qualified_name))) {
    return null;
  }

  // Only fire when the handler IS reading the signature header. Without that
  // signal, we can't say the comparison side is the bug.
  if (!handler.evidence.some((e) => e.kind === "signature_header_read")) return null;

  if (reachesPrefixStripping(handler)) return null;

  return "manual-review";
};
