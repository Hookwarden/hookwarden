// Pure: no fs / http / network / process / node:*. Required by .dependency-cruiser.cjs
// rules-predicates-no-node-core + rules-predicates-no-network-libs (D-28).
//
// D-92 custom-predicate slot — second occupant (Twilio's twilio-signing.ts is first).
// Standard Webhooks (https://www.standardwebhooks.com) signs HMAC-SHA256 over
// `{webhook-id}.{webhook-timestamp}.{rawBody}` and emits the result as base64. The
// canonical-string includes a non-payload message id, so the signing recipe does NOT fit
// the parameterized `timestamp_dot_body` shape used by Slack/Zendesk — the catalog entry
// sets signing_input_format: 'custom' and the missing-signature-verification factory
// dispatches here via CUSTOM_SIGNING_PREDICATES['standardwebhooks'] (JS/TS + Python) and
// CUSTOM_PHP_SIGNING_PREDICATES['standardwebhooks'] (PHP).
//
// 08.3 Plan 16b — hand-rolled prong (the Clerk CVE-2025-53548 catch). When a handler builds
// the `{id}.{ts}.{body}` signing string and computes the HMAC by hand, the comparison step is
// the load-bearing security check. This predicate distinguishes THREE hand-rolled outcomes on a
// `standardwebhooks`-attributed handler:
//   - a RECOGNIZED comparison is reachable (crypto.timingSafeEqual / hmac.compare_digest /
//     hash_equals, or a broad `.equals` / `.compare` form) → return null (defer; the
//     timing-unsafe / missing-timestamp factory predicates grade it further).
//   - only an UNRECOGNIZED comparison-shaped symbol is reachable (a project-local wrapper such
//     as safeCompare() / verifySig() whose body can't be statically inspected) → "manual-review"
//     (a human must confirm; do NOT hard-flag — protects the <5% FP moat).
//   - ZERO comparison-shaped symbols of any kind are reachable → "not-verified" (the hard CVE
//     catch — the signature is computed but never checked, so every forged request is accepted).
// PHP parity reuses the timing-unsafe Path-B idiom: walk the handler's tree-sitter-php AST
// directly (engine reachability is bounded to babel + tree-sitter-python in v1).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import { PROVIDER_CATALOG } from "../../catalog.js";
import {
  isManualHmacEntry,
  isRecognizedComparisonSymbol,
  isUnrecognizedComparisonShapedSymbol,
  reachesSdkVerifyCall,
} from "../_helpers.js";
import {
  findInsecureStringComparisons,
  isPhpHashEqualsCall,
  type PhpSyntaxNode,
  type PhpTree,
  walkPhpCalls,
} from "../_helpers-php.js";
import {
  CUSTOM_PHP_SIGNING_PREDICATES,
  CUSTOM_SIGNING_PREDICATES,
} from "../missing-signature-verification.js";

const STANDARDWEBHOOKS_CATALOG =
  PROVIDER_CATALOG["standardwebhooks"] ??
  (() => {
    throw new Error("PROVIDER_CATALOG entry for 'standardwebhooks' is missing");
  })();

export const standardwebhooksSigningPredicate: RulePredicate = async (
  handler: WebhookHandler,
  model: ProjectModel,
) => {
  if (handler.provider !== "standardwebhooks") return null;

  // Path B (parity with library-verified-recognition) — inline-middleware / PHP-overlay
  // sdk_verify_call evidence emitted by the build.ts overlays (Phase 8.1 Plan 07). When present,
  // verification lives in a route-arg arrow / middleware the symbol graph doesn't walk → defer.
  if (
    handler.evidence.some((e) => e.kind === "sdk_verify_call" && e.provider === "standardwebhooks")
  ) {
    return null;
  }

  // PHP — engine reachability does not populate reachable_symbols for PHP handlers, so inspect
  // the handler's tree-sitter-php AST directly (same Path-B idiom as timing-unsafe-comparison.ts).
  const parsedFile = model?.parsed_files?.find((f) => f.file_path === handler.file_path);
  if (parsedFile?.dialect === "tree-sitter-php") {
    return evaluatePhpHandRolled(handler, parsedFile);
  }

  // JS/TS + Python — reachable_symbols populated by engine reachability (D-34).
  const symbols = handler.reachable_symbols;
  if (
    reachesSdkVerifyCall(
      symbols,
      STANDARDWEBHOOKS_CATALOG.sdk_verify_calls,
      STANDARDWEBHOOKS_CATALOG.sdk_packages,
    )
  ) {
    return null;
  }

  if (symbols.some((s) => isManualHmacEntry(s.qualified_name))) {
    // Hand-rolled HMAC reachable — the comparison step decides the verdict (three-way split).
    if (symbols.some((s) => isRecognizedComparisonSymbol(s.qualified_name))) return null;
    if (symbols.some((s) => isUnrecognizedComparisonShapedSymbol(s.qualified_name))) {
      return "manual-review";
    }
    // Manual HMAC computed but NO comparison-shaped symbol of any kind → CVE-2025-53548 shape.
    return "not-verified";
  }

  // Neither the library nor a manual HMAC entry is reachable — no verification attempted at all.
  return "not-verified";
};

// PHP hand-rolled evaluation — mirrors the JS/Python three-way split over the handler's PHP AST.
function evaluatePhpHandRolled(
  handler: WebhookHandler,
  parsedFile: {
    readonly dialect: string;
    readonly parse_error: unknown;
    readonly raw_ast: unknown;
  },
): "not-verified" | "manual-review" | null {
  if (parsedFile.parse_error !== null || parsedFile.raw_ast === null) return null;

  const tree = parsedFile.raw_ast as PhpTree;
  const scopeNode = (handler as unknown as { handler_body_node?: PhpSyntaxNode }).handler_body_node;
  const root: PhpSyntaxNode = scopeNode ?? tree.rootNode;
  const calls = walkPhpCalls(root);

  const usesHashHmac = calls.some((c) => {
    if (c.kind !== "function") return false;
    const fnNode = c.node.childForFieldName("function");
    if (!fnNode) return false;
    return fnNode.text === "hash_hmac" || fnNode.text === "\\hash_hmac";
  });
  // No manual HMAC and (already established above) no library/overlay verify → nothing attempted.
  if (!usesHashHmac) return "not-verified";

  // Recognized constant-time compare → defer (timing-unsafe / other rules grade it).
  const usesHashEquals = calls.some((c) => {
    if (c.kind !== "function") return false;
    const fnNode = c.node.childForFieldName("function");
    return fnNode !== null && isPhpHashEqualsCall(fnNode.text);
  });
  if (usesHashEquals) return null;

  // A recognized-but-insecure comparison (=== / == / strcmp on signature material) → defer to
  // standardwebhooks/timing-unsafe-comparison, which owns the unsafe-compare verdict.
  if (findInsecureStringComparisons(root).length > 0) return null;

  // An unrecognized compare-shaped call (a local verifySignature() / safeCompare()) → manual-review.
  const hasUnrecognizedCompare = calls.some((c) => {
    const name = phpCalleeName(c.node, c.kind);
    if (name === null) return false;
    if (name === "hash_hmac" || isPhpHashEqualsCall(name)) return false;
    return isUnrecognizedComparisonShapedSymbol(name);
  });
  if (hasUnrecognizedCompare) return "manual-review";

  // hash_hmac computed, ZERO comparison of any kind → the CVE-2025-53548 catch.
  return "not-verified";
}

// Best-effort callee name for a PHP call site across function / member / scoped forms.
function phpCalleeName(node: PhpSyntaxNode, kind: "function" | "member" | "scoped"): string | null {
  if (kind === "function") return node.childForFieldName("function")?.text ?? null;
  return node.childForFieldName("name")?.text ?? null;
}

// Side-effect registration: when missing-signature-verification.ts imports this module
// (transitively via predicates/index.ts), the custom-signing slots are populated at module-load
// time. Registered for BOTH the JS/TS+Python dispatch and the PHP dispatch (Plan 16b).
CUSTOM_SIGNING_PREDICATES["standardwebhooks"] = standardwebhooksSigningPredicate;
CUSTOM_PHP_SIGNING_PREDICATES["standardwebhooks"] = standardwebhooksSigningPredicate;
