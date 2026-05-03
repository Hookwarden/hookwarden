// RULES-02 detection #4 (GitHub). GitHub does not include a timestamp inside its signature
// header — replay defense relies on persisting and rejecting previously-seen
// `X-GitHub-Delivery` UUIDs. When the manual-HMAC path is detected and no
// persistence-adjacent symbol (Map/Set lookup, redis client) is reachable, emit
// 'manual-review' per D-29 graded-confidence policy.
//
// SDK path (`@octokit/webhooks` `verify` / `verifyRequest`) is exempt: callers integrating
// with Octokit are expected to handle delivery dedupe at the application boundary.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";

const GITHUB_SDK_VERIFY: ReadonlySet<string> = new Set(["verify", "verifyRequest"]);
const GITHUB_SDK_PACKAGES: ReadonlySet<string> = new Set([
  "@octokit/webhooks",
  "@octokit/webhooks-methods",
]);

const PERSISTENCE_HINTS: ReadonlyArray<string> = [
  ".has",
  ".set",
  ".add",
  ".get",
  ".delete",
  "Map.prototype",
  "Set.prototype",
  "redis",
];

function isManualHmacEntry(name: string): boolean {
  return (
    name === "crypto.createHmac" ||
    name.endsWith(".createHmac") ||
    name === "hmac.new" ||
    name.endsWith(".hmac.new")
  );
}

export const githubMissingTimestampCheckPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "github") return null;
  const symbols = handler.reachable_symbols;
  const hasSdkVerify = symbols.some((s) => {
    if (s.import_source === null) return false;
    if (!GITHUB_SDK_PACKAGES.has(s.import_source)) return false;
    for (const v of GITHUB_SDK_VERIFY) {
      if (s.qualified_name === v || s.qualified_name.endsWith(`.${v}`)) return true;
    }
    return false;
  });
  if (hasSdkVerify) return null;
  if (!symbols.some((s) => isManualHmacEntry(s.qualified_name))) return null;
  const hasPersistence = symbols.some((s) =>
    PERSISTENCE_HINTS.some((h) => s.qualified_name.includes(h)),
  );
  if (hasPersistence) return null;
  return "manual-review";
};
