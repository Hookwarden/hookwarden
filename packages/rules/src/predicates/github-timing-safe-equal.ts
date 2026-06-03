// Smoke-test rule predicate (D-28). Validates the engine ↔ rules contract end-to-end.
// Pure: no fs / http / network / process. Receives WebhookHandler + ProjectModel; returns Verdict | null.
// Returns null when the rule does not apply (engine then ignores; rule produces no Finding).
//
// Phase 8.1 Plan 08: dispatch to PHP-specific AST inspection when the handler's source file is
// tree-sitter-php. PHP's analog of `crypto.timingSafeEqual` is `hash_equals` (PHP 5.6+).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import { type GoSyntaxNode, type GoTree, goTimingUnsafeResult } from "./_helpers-go.js";
import {
  findInsecureStringComparisons,
  isPhpHashEqualsCall,
  type PhpSyntaxNode,
  type PhpTree,
  walkPhpCalls,
} from "./_helpers-php.js";

// "GitHub webhook handler whose reachable_symbols include neither
// crypto.timingSafeEqual nor an SDK verify call → emits not-verified."
// Otherwise returns null — the rule does not fire.
//
// This predicate backs `critical`-severity rules (github/missing-timing-safe-equal +
// github/timing-unsafe-comparison). The engine builds a Finding for ANY non-null verdict and
// stamps it with the rule's fixed `critical` severity + "verification missing" message. So a
// `critical` rule must return null — never "verified" — on the safe path, or a textbook-correct
// hand-rolled handler (crypto.createHmac + crypto.timingSafeEqual) surfaces a false-positive
// critical and fails the build. The positive "verified" signal is the job of the info-severity
// github/library-verified rule, not this one. (The sibling github-php-timing-safe-equal predicate
// already follows this null-on-safe-path convention.)
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

  // Path C (Go, Phase 27) — bytes.Equal / ==-on-MAC → not-verified; hmac.Equal or an SDK verify
  // (github.ValidatePayload, carrying sdk_verify_call evidence) → null.
  if (parsedFile?.dialect === "tree-sitter-go") {
    return evaluateGoGithubTimingSafeEqual(handler, parsedFile);
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
  // Safe path → null (no finding). See header note: a critical rule must not emit on a verified handler.
  if (hasTimingSafe || hasSdkVerify) return null;
  return "not-verified";
};

function evaluateGoGithubTimingSafeEqual(
  handler: WebhookHandler,
  parsedFile: { readonly parse_error: unknown; readonly raw_ast: unknown },
): "not-verified" | null {
  if (parsedFile.parse_error !== null || parsedFile.raw_ast === null) return null;
  // SDK path exemption — github.ValidatePayload / ValidateSignature carry sdk_verify_call evidence.
  if (handler.evidence.some((e) => e.kind === "sdk_verify_call" && e.provider === "github")) {
    return null;
  }
  const tree = parsedFile.raw_ast as GoTree;
  const scopeNode = (handler as unknown as { handler_body_node?: GoSyntaxNode }).handler_body_node;
  const root: GoSyntaxNode = scopeNode ?? tree.rootNode;
  return goTimingUnsafeResult(root);
}

function evaluatePhpGithubTimingSafeEqual(
  handler: WebhookHandler,
  parsedFile: { readonly parse_error: unknown; readonly raw_ast: unknown },
): "not-verified" | null {
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
  if (usesHashEquals) return null; // safe path — see header note (null, never "verified", on a critical rule)

  // No hash_equals — check for insecure comparison. If any unsafe form is present, emit
  // not-verified. If no comparison at all, the rule does not apply (a handler with no
  // comparison logic isn't doing timing checks at all — other rules cover that case).
  const insecure = findInsecureStringComparisons(root);
  if (insecure.length === 0) return null;
  return "not-verified";
}
