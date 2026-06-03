// Phase 27 (RULES-GO-01) — Go-specific Stripe timing-unsafe-comparison predicate.
//
// Engine reachability now walks Go (collectCallsGo, plan 27-02), but the constant-time verdict is
// an AST-shape question best answered by direct inspection of the handler body, mirroring the PHP
// predicate. This standalone predicate is the unit-testable surface; the live rule path is the
// factory's Go branch in timing-unsafe-comparison.ts (both share goTimingUnsafeResult).
//
// NULL-ON-SAFE-PATH DISCIPLINE (MEMORY project_critical_rule_safe_path_must_return_null): a
// critical predicate returns null on the safe path and CAN NEVER return the verified state — that is a
// pipeline STATE emitted by the info-severity library-verified rule on sdk_verify_call evidence.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import { type GoTree, goTimingUnsafeResult, type GoSyntaxNode } from "./_helpers-go.js";

export const stripeGoTimingUnsafeComparisonPredicate: RulePredicate = async (
  handler: WebhookHandler,
  model: ProjectModel,
) => {
  if (handler.provider !== "stripe") return null;

  const parsedFile = model?.parsed_files?.find((f) => f.file_path === handler.file_path);
  if (!parsedFile) return null;
  if (parsedFile.dialect !== "tree-sitter-go") return null;
  if (parsedFile.parse_error !== null || parsedFile.raw_ast === null) return null;

  // SDK path exemption — an SDK-verified handler (webhook.ConstructEvent) carries sdk_verify_call
  // evidence; the SDK compares internally, so the timing rule does not apply (it renders verified
  // via library-verified instead).
  if (
    handler.evidence.some((e) => e.kind === "sdk_verify_call" && e.provider === handler.provider)
  ) {
    return null;
  }

  const tree = parsedFile.raw_ast as GoTree;
  const scopeNode = (handler as unknown as { handler_body_node?: GoSyntaxNode }).handler_body_node;
  const root: GoSyntaxNode = scopeNode ?? tree.rootNode;

  // Returns null (safe: hmac.Equal / no manual HMAC / no insecure compare) or "not-verified".
  return goTimingUnsafeResult(root);
};
