// Phase 8.1 Plan 08 — PHP-specific Stripe timing-unsafe-comparison predicate (D-04 layer 2).
//
// Why a separate file from `timing-unsafe-comparison.ts`: the generic predicate keys on
// `handler.reachable_symbols` (a language-agnostic structure populated by engine reachability).
// PHP reachability is bounded in Phase 8.1 v1 — the engine reach pass currently only walks
// babel + tree-sitter-python. PHP handlers therefore need direct AST inspection inside the
// handler's source-text range. That's a per-provider concern: this file anchors on Stripe's
// `$_SERVER['HTTP_STRIPE_SIGNATURE']` and the catalog's `secret_literal_prefix` (whsec_) shape.
//
// Pure: no fs / http / network / process / node:* (D-28). Operates on PHP AST nodes via the
// shared helpers in `_helpers-php.ts`.

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import {
  findInsecureStringComparisons,
  isPhpHashEqualsCall,
  type PhpSyntaxNode,
  type PhpTree,
  walkPhpCalls,
} from "./_helpers-php.js";

export const stripePhpTimingUnsafeComparisonPredicate: RulePredicate = async (
  handler: WebhookHandler,
  model: ProjectModel,
) => {
  if (handler.provider !== "stripe") return null;

  const parsedFile = model.parsed_files.find((f) => f.file_path === handler.file_path);
  if (!parsedFile) return null;
  if (parsedFile.dialect !== "tree-sitter-php") return null;
  if (parsedFile.parse_error !== null || parsedFile.raw_ast === null) return null;

  const tree = parsedFile.raw_ast as PhpTree;
  // Scope: walk only the handler's source range so a finding anchors to the handler that
  // contains the comparison, not an unrelated comparison elsewhere in the same file. The
  // handler_body_node holds the closure / method body — fall back to the root if absent.
  const scopeNode = (handler as unknown as { handler_body_node?: PhpSyntaxNode }).handler_body_node;
  const root: PhpSyntaxNode = scopeNode ?? tree.rootNode;

  const insecure = findInsecureStringComparisons(root);
  if (insecure.length === 0) return null;

  // If hash_equals appears anywhere in the handler body, the developer used the safe form
  // somewhere — the rule does not emit. Plan 09 fixture corpus will exercise the "mixed
  // safe + unsafe" case; current policy is conservative (any safe form silences the rule).
  const calls = walkPhpCalls(root);
  const usesHashEquals = calls.some((c) => {
    if (c.kind !== "function") return false;
    const fnNode = c.node.childForFieldName("function");
    return fnNode !== null && isPhpHashEqualsCall(fnNode.text);
  });
  if (usesHashEquals) return null;

  return "not-verified";
};
