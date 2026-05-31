// Detector #1 — n8n/webhook-trigger-no-authentication (critical).
//
// A self-contained RulePredicate (NOT a matcher-union variant — see 24-02-PLAN
// corrected objective + 24-01-SUMMARY "predicate-not-matcher path confirmed").
// The n8n adapter (Plan 24-01) walks `*.workflow.json` and emits one synthetic
// webhook-trigger handler per Webhook node; model wiring (Plan 24-03) lifts that
// descriptor into a full WebhookHandler carrying the node params as
// `n8n_node_param` evidence (`detail` = "authentication=<value>"). This predicate
// reads that evidence and fires when the trigger is unauthenticated.
//
// Normalization (Pitfall 1): the adapter collapses a MISSING `authentication` key
// to "none" (n8n's UI default and the most common vulnerable export shape). To be
// robust even if the evidence is absent entirely, the predicate also treats a
// missing `authentication=` evidence as "none" — so absent and literal "none"
// share one fire path.
//
// Provider + framework guards: detector #1 is scoped to the JSON-workflow synthetic
// handler only (`provider === "n8n"` AND `framework === "n8n-workflow"`). A TS
// custom-node handler (detector #2's target) must NOT be caught here.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";

const AUTH_PREFIX = "authentication=";

export const n8nTriggerNoAuthPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "n8n" || handler.framework !== "n8n-workflow") return null;

  const authEvidence = handler.evidence.find(
    (e) => e.kind === "n8n_node_param" && e.detail.startsWith(AUTH_PREFIX),
  );
  // Missing evidence => treat as "none" (absent key normalizes to the vulnerable shape).
  const value = authEvidence ? authEvidence.detail.slice(AUTH_PREFIX.length) : "none";

  return value === "none" ? "not-verified" : null;
};
