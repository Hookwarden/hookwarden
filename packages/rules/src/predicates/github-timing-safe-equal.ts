// Smoke-test rule predicate (D-28). Validates the engine ↔ rules contract end-to-end.
// Pure: no fs / http / network / process. Receives WebhookHandler + ProjectModel; returns Verdict | null.
// Returns null when the rule does not apply (engine then ignores; rule produces no Finding).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";

// "GitHub webhook handler whose reachable_symbols include neither
// crypto.timingSafeEqual nor an SDK verify call → emits not-verified."
// Otherwise emits verified (the rule still emits a verdict, per D-29).
//
// Trusts the bounded-depth reachability set computed by the engine (D-34). Phase 6's full
// GitHub rule will combine this with header / raw-body / replay checks.
export const githubTimingSafeEqualPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "github") return null;
  const symbols = handler.reachable_symbols;
  const hasTimingSafe = symbols.some(
    (s) =>
      s.qualified_name === "crypto.timingSafeEqual" ||
      s.qualified_name.endsWith(".timingSafeEqual"),
  );
  const hasSdkVerify = symbols.some(
    (s) =>
      s.import_source === "@octokit/webhooks" || s.import_source === "@octokit/webhooks-methods",
  );
  if (hasTimingSafe || hasSdkVerify) return "verified";
  return "not-verified";
};
