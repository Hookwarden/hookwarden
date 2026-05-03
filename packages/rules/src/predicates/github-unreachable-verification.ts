// RULES-02 detection #7 (GitHub). `@octokit/webhooks{,-methods}` is imported in the
// handler's file but no `verify` / `verifyRequest` call (anchored to that import_source)
// is reachable from the handler entry point within the engine's reachability budget (D-34).
// Verification might be conditional, dynamically dispatched, in dead code, or absent.
// Emit 'manual-review' so the user can inspect, rather than 'not-verified' which would
// create noise on legitimate-but-indirect verification patterns.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";

const GITHUB_SDK_VERIFY: ReadonlySet<string> = new Set(["verify", "verifyRequest"]);
const GITHUB_SDK_PACKAGES: ReadonlySet<string> = new Set([
  "@octokit/webhooks",
  "@octokit/webhooks-methods",
]);

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

export const githubUnreachableVerificationPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "github") return null;
  const githubImported = handler.evidence.some(
    (e) => e.kind === "sdk_import" && e.provider === "github",
  );
  if (!githubImported) return null;
  if (reachesGithubSdkVerify(handler)) return null;
  return "manual-review";
};
