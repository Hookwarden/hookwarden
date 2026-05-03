// RULES-02 detection #5 (Stripe). Stripe webhooks require HMAC-SHA256. When manual HMAC path is
// detected and a non-sha256 algorithm symbol is reachable, emit 'not-verified'. When the algorithm
// cannot be statically resolved, emit 'manual-review' (the engine doesn't currently inspect the
// `createHmac('sha256', ...)` first-argument literal — Phase 6 hardens this).
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";

const NON_SHA256_HINTS: ReadonlyArray<string> = [
  ".md5",
  ".sha1",
  ".sha384",
  ".sha512",
  ".ripemd160",
];
const SHA256_HINTS: ReadonlyArray<string> = [".sha256"];

function isManualHmacEntry(name: string): boolean {
  return (
    name === "crypto.createHmac" ||
    name.endsWith(".createHmac") ||
    name === "hmac.new" ||
    name.endsWith(".hmac.new")
  );
}

function endsWithAny(name: string, suffixes: ReadonlyArray<string>): boolean {
  for (const s of suffixes) {
    if (name.endsWith(s)) return true;
  }
  return false;
}

export const stripeWrongHmacAlgorithmPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "stripe") return null;
  const symbols = handler.reachable_symbols;
  if (!symbols.some((s) => isManualHmacEntry(s.qualified_name))) return null;
  if (symbols.some((s) => endsWithAny(s.qualified_name, NON_SHA256_HINTS))) return "not-verified";
  if (symbols.some((s) => endsWithAny(s.qualified_name, SHA256_HINTS))) return null;
  return "manual-review";
};
