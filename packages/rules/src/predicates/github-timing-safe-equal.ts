// Smoke-test rule predicate (D-28). Validates the engine ↔ rules contract end-to-end.
// Pure: no fs / http / network / process. Receives WebhookHandler + ProjectModel; returns Verdict | null.
// Returns null when the rule does not apply (engine then ignores; rule produces no Finding).
//
// Phase 8.1 Plan 08: dispatch to PHP-specific AST inspection when the handler's source file is
// tree-sitter-php. PHP's analog of `crypto.timingSafeEqual` is `hash_equals` (PHP 5.6+).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import {
  findInsecureStringComparisons,
  isPhpHashEqualsCall,
  type PhpSyntaxNode,
  type PhpTree,
  walkPhpCalls,
} from "./_helpers-php.js";

// "GitHub webhook handler whose reachable_symbols include neither
// crypto.timingSafeEqual nor an SDK verify call → emits not-verified."
// Otherwise emits verified (the rule still emits a verdict, per D-29).
//
// Trusts the bounded-depth reachability set computed by the engine (D-34). Phase 6's full
// GitHub rule will combine this with header / raw-body / replay checks.
export const githubTimingSafeEqualPredicate: RulePredicate = async (
  handler: WebhookHandler,
  model: ProjectModel,
) => {
  if (handler.provider !== "github") return null;

  // Path B (PHP) — direct AST inspection.
  // Defensive: existing tests cast model as never; tolerate missing parsed_files.
  const parsedFile = model?.parsed_files?.find((f) => f.file_path === handler.file_path);
  if (parsedFile?.dialect === "tree-sitter-php") {
    return evaluatePhpGithubTimingSafeEqual(handler, parsedFile);
  }

  // Path A (JS / Python) — reachable_symbols.
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

function evaluatePhpGithubTimingSafeEqual(
  handler: WebhookHandler,
  parsedFile: { readonly parse_error: unknown; readonly raw_ast: unknown },
): "verified" | "not-verified" | null {
  if (parsedFile.parse_error !== null || parsedFile.raw_ast === null) return null;

  const tree = parsedFile.raw_ast as PhpTree;
  const scopeNode = (handler as unknown as { handler_body_node?: PhpSyntaxNode }).handler_body_node;
  const root: PhpSyntaxNode = scopeNode ?? tree.rootNode;

  const calls = walkPhpCalls(root);
  const usesHashEquals = calls.some((c) => {
    if (c.kind !== "function") return false;
    const fnNode = c.node.childForFieldName("function");
    return fnNode !== null && isPhpHashEqualsCall(fnNode.text);
  });
  if (usesHashEquals) return "verified";

  // No hash_equals — check for insecure comparison. If any unsafe form is present, emit
  // not-verified. If no comparison at all, the rule does not apply (a handler with no
  // comparison logic isn't doing timing checks at all — other rules cover that case).
  const insecure = findInsecureStringComparisons(root);
  if (insecure.length === 0) return null;
  return "not-verified";
}
