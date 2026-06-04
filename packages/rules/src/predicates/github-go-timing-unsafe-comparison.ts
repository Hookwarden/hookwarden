// Phase 27 (RULES-GO-01) — Go-specific GitHub timing-unsafe-comparison predicate.
// Same shape + null-on-safe-path discipline as the Stripe Go predicate; gates on provider github.
// Standalone unit-testable surface; the live rule path is the Go branch in github-timing-safe-equal.ts
// (both share goTimingUnsafeResult). NEVER returns the verified state (critical predicate).
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import { type GoSyntaxNode, type GoTree, goTimingUnsafeResult } from "./_helpers-go.js";

export const githubGoTimingUnsafeComparisonPredicate: RulePredicate = async (
  handler: WebhookHandler,
  model: ProjectModel,
) => {
  if (handler.provider !== "github") return null;

  const parsedFile = model?.parsed_files?.find((f) => f.file_path === handler.file_path);
  if (!parsedFile) return null;
  if (parsedFile.dialect !== "tree-sitter-go") return null;
  if (parsedFile.parse_error !== null || parsedFile.raw_ast === null) return null;

  // SDK path exemption — github.ValidatePayload / ValidateSignature carry sdk_verify_call evidence.
  if (
    handler.evidence.some((e) => e.kind === "sdk_verify_call" && e.provider === handler.provider)
  ) {
    return null;
  }

  const tree = parsedFile.raw_ast as GoTree;
  const scopeNode = (handler as unknown as { handler_body_node?: GoSyntaxNode }).handler_body_node;
  const root: GoSyntaxNode = scopeNode ?? tree.rootNode;

  return goTimingUnsafeResult(root);
};
