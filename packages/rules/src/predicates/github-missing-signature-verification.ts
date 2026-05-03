// RULES-02 detection #1 (GitHub). Emits not-verified when neither @octokit/webhooks `verify`
// nor a manual HMAC path is reachable from the handler within the engine's bounded-depth
// reachability (D-34, default 3 hops). The SDK match requires both qualified_name AND
// import_source narrowing because "verify" / "verifyRequest" are too generic to accept
// without anchoring to @octokit/webhooks{,-methods}.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";

const GITHUB_SDK_VERIFY: ReadonlySet<string> = new Set(["verify", "verifyRequest"]);
const GITHUB_SDK_PACKAGES: ReadonlySet<string> = new Set([
  "@octokit/webhooks",
  "@octokit/webhooks-methods",
]);

function reachesManualHmacEntry(handler: WebhookHandler): boolean {
  return handler.reachable_symbols.some(
    (s) =>
      s.qualified_name === "crypto.createHmac" ||
      s.qualified_name.endsWith(".createHmac") ||
      s.qualified_name === "hmac.new" ||
      s.qualified_name.endsWith(".hmac.new"),
  );
}

function reachesGithubSdkVerify(handler: WebhookHandler): boolean {
  for (const sym of handler.reachable_symbols) {
    if (sym.import_source === null) continue;
    if (!GITHUB_SDK_PACKAGES.has(sym.import_source)) continue;
    for (const v of GITHUB_SDK_VERIFY) {
      if (sym.qualified_name === v || sym.qualified_name.endsWith(`.${v}`)) return true;
    }
  }
  return false;
}

export const githubMissingSignatureVerificationPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "github") return null;
  if (reachesGithubSdkVerify(handler)) return null;
  if (reachesManualHmacEntry(handler)) return null;
  return "not-verified";
};
