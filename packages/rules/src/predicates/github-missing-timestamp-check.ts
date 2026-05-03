// RULES-02 detection #4 (GitHub). GitHub does not include a timestamp inside its signature
// header — replay defense relies on persisting and rejecting previously-seen
// `X-GitHub-Delivery` UUIDs. When a manual-HMAC path is reachable and no SDK verify is
// reachable, emit 'manual-review' per D-29 graded-confidence policy: we cannot statically
// prove whether the handler implements delivery dedupe, so surface for human review.
//
// Earlier iterations attempted to suppress manual-review when "persistence-adjacent" symbols
// were reachable (Map/Set lookups, redis client). That heuristic was abandoned (review CR-01):
// substring matches on `.has` / `.set` / `.add` / `.get` / `.delete` collide with everyday
// qualified names like `crypto.createHash`, `res.setHeader`, `req.get`, `headers.delete` —
// suppressing the manual-review on the majority of real handlers and producing false negatives
// on a security-critical rule. The conservative stance (always manual-review when manual HMAC
// is present and SDK is not) is correct for the three-state moat; static taint analysis on the
// `X-GitHub-Delivery` UUID is a Phase 6 follow-up.
//
// SDK path (`@octokit/webhooks{,-methods}` `verify` / `verifyRequest`) is exempt: callers
// integrating with Octokit are expected to handle delivery dedupe at the application boundary.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";

const GITHUB_SDK_VERIFY: ReadonlySet<string> = new Set(["verify", "verifyRequest"]);
const GITHUB_SDK_PACKAGES: ReadonlySet<string> = new Set([
  "@octokit/webhooks",
  "@octokit/webhooks-methods",
]);

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
  return "manual-review";
};
