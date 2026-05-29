// 08.3 Plan 03 (retrofit) — Intercom octokit cross-attribution rule.
//
// Intercom and GitHub legacy webhooks both use the `X-Hub-Signature` header
// name (Intercom literally re-uses GitHub's header). This creates a real,
// documented confusion: developers who already wired GitHub webhook verification
// using `@octokit/webhooks` reach for the same library to verify Intercom
// signatures — but `@octokit/webhooks` validates against the GitHub webhook
// secret, NOT the Intercom secret. Verification appears successful in the
// sense that no exception is thrown, but the secret being checked against is
// the wrong one — the handler will either accept any well-formed signature
// blindly (if no GitHub secret is configured), or reject every Intercom
// delivery (if a GitHub secret IS configured and the Intercom HMAC doesn't
// match it).
//
// Detection: when an Intercom-attributed handler has reachable_symbols with
// import_source = "@octokit/webhooks" or "@octokit/webhooks-methods", emit
// `not-verified`. This is high-confidence: the libraries exist solely to
// verify GitHub-style signatures against a configured GitHub secret; their
// presence in an Intercom handler is a contract-violation bug.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";

const OCTOKIT_WEBHOOK_PACKAGES: ReadonlySet<string> = new Set([
  "@octokit/webhooks",
  "@octokit/webhooks-methods",
]);

export const intercomOctokitCrossAttributionPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "intercom") return null;

  const importsOctokitWebhooks = handler.reachable_symbols.some(
    (s) => s.import_source !== null && OCTOKIT_WEBHOOK_PACKAGES.has(s.import_source),
  );
  if (!importsOctokitWebhooks) return null;

  return "not-verified";
};
