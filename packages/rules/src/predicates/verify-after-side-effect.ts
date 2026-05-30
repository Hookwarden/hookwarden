// VAS-01 — Cross-cutting predicate for the verify-after-side-effect bug class.
// Reads the engine's `side_effect_before_verify` evidence (emitted by
// model/handler-cfg.ts, Phase 13 Stage C). If any such evidence is present
// on the handler, emit `manual-review`. The conservative initial verdict
// matches the v0.7.0 ship plan; promotion to `not-verified` is gated on
// corpus FP-rate validation (RD-08 / v0.7.1 follow-up via VAS-02).
//
// Provider scoping: the engine attaches the resolved provider name to each
// `side_effect_before_verify` evidence. The predicate trusts the engine's
// attribution — its job is to consume the evidence + emit the verdict, not
// re-derive provider scope.
//
// JS/TS only at v0.7.0: the engine's handler-cfg overlay returns no evidence
// for tree-sitter handlers (Python/PHP). Those handlers naturally produce
// no `side_effect_before_verify` evidence and the predicate returns null.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";

export function createVerifyAfterSideEffectPredicate(provider: string): RulePredicate {
  return async (handler: WebhookHandler, _model: ProjectModel) => {
    if (handler.provider !== provider) return null;
    const evidence = handler.evidence.filter(
      (e) => e.kind === "side_effect_before_verify" && e.provider === provider,
    );
    if (evidence.length === 0) return null;
    return "manual-review";
  };
}

// __test_only export — exposes raw filter behavior for unit tests that want
// to assert against the evidence shape without spinning up a full ProjectModel.
// biome-ignore lint/style/useNamingConvention: __test_only is a deliberate test-export convention
export const __test_only = {
  filterSideEffectEvidence(handler: WebhookHandler, provider: string) {
    return handler.evidence.filter(
      (e) => e.kind === "side_effect_before_verify" && e.provider === provider,
    );
  },
};
