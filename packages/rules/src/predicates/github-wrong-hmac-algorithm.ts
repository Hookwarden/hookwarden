// RULES-02 detection #5 (GitHub). GitHub webhook signature header is `X-Hub-Signature-256`
// (HMAC-SHA256). When manual-HMAC is detected and a non-sha256 algorithm symbol is
// reachable, emit 'not-verified'. When the algorithm cannot be statically resolved
// (no .sha256 hint, no wrong-algo hint), emit 'manual-review' per D-29.
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

export const githubWrongHmacAlgorithmPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "github") return null;
  const symbols = handler.reachable_symbols;
  if (!symbols.some((s) => isManualHmacEntry(s.qualified_name))) return null;
  const hasWrong = symbols.some((s) => endsWithAny(s.qualified_name, NON_SHA256_HINTS));
  const hasSha256 = symbols.some((s) => endsWithAny(s.qualified_name, SHA256_HINTS));
  // WR-01 (review): if BOTH algorithm symbols are reachable (e.g., handler uses sha256 for
  // HMAC and sha1 for an unrelated ETag), the engine cannot statically tell which one feeds
  // HMAC. Emit manual-review rather than false-flag the wrong-algo finding.
  if (hasSha256 && hasWrong) return "manual-review";
  if (hasWrong) return "not-verified";
  if (hasSha256) return null;
  return "manual-review";
};
