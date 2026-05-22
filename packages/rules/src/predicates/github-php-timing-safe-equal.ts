// Phase 8.1 Plan 08 — PHP-specific GitHub timing-safe-equal predicate (D-04 layer 2).
//
// GitHub has no canonical PHP webhook SDK (catalog has no PHP entries for github — per
// Plan 07 Task 2 contract). PHP github webhook verification is overwhelmingly hand-rolled
// `hash_hmac` + `hash_equals`. This rule catches the case where the developer reached for
// `==` / `===` / `strcmp(...) === 0` instead of `hash_equals` — same D-09 patterns as Stripe
// but anchored on the github provider tag.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import {
  findInsecureStringComparisons,
  isPhpHashEqualsCall,
  type PhpSyntaxNode,
  type PhpTree,
  walkPhpCalls,
} from "./_helpers-php.js";

export const githubPhpTimingSafeEqualPredicate: RulePredicate = async (
  handler: WebhookHandler,
  model: ProjectModel,
) => {
  if (handler.provider !== "github") return null;

  const parsedFile = model.parsed_files.find((f) => f.file_path === handler.file_path);
  if (!parsedFile) return null;
  if (parsedFile.dialect !== "tree-sitter-php") return null;
  if (parsedFile.parse_error !== null || parsedFile.raw_ast === null) return null;

  const tree = parsedFile.raw_ast as PhpTree;
  const scopeNode = (handler as unknown as { handler_body_node?: PhpSyntaxNode }).handler_body_node;
  const root: PhpSyntaxNode = scopeNode ?? tree.rootNode;

  // If hash_equals is present, the handler is using the safe form — emit nothing.
  const calls = walkPhpCalls(root);
  const usesHashEquals = calls.some((c) => {
    if (c.kind !== "function") return false;
    const fnNode = c.node.childForFieldName("function");
    return fnNode !== null && isPhpHashEqualsCall(fnNode.text);
  });
  if (usesHashEquals) return null;

  // No hash_equals — check whether any insecure equality comparison is present in the handler.
  const insecure = findInsecureStringComparisons(root);
  if (insecure.length === 0) return null;

  return "not-verified";
};
