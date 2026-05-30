// Linear-scan CFG-lite for webhook handler bodies. Walks the top-level
// statements of a JS/TS handler function, classifies each via
// side-effect-classifier, and emits `side_effect_before_verify` evidence
// for any T1/T2 side effect that appears BEFORE a verification statement.
//
// Branch-agnostic by design — every statement is classified in source order;
// branches are not unrolled. A true branch-aware CFG is deferred to v0.8
// (RD-08) if v0.7 corpus data shows it would reduce FP/FN materially.
//
// Language scope: JS/TS only at v0.7.0. The function returns an empty array
// for any other `handler_body_node` shape (PHP tree-sitter nodes, Python
// AST nodes). VAS-01 for Python/PHP lands in v0.7.1.
//
// Integration: assembleHandler in build.ts calls this AFTER baseEvidence /
// sdkVerifyEvidence / inlineMwVerifyEvidence are computed. The verification
// signal is derived from BOTH:
//   (a) Direct call shapes whose qualified name matches catalog
//       sdk_verify_calls — picked up via in-body Statement walk here.
//   (b) Reachability — pre-resolved via computeReachableSymbols; a helper
//       function call whose body reaches verify is treated as verification
//       (caller passes verifiedCallNames including helper qnames).
//
// This module is PURE.

import type {
  ArrowFunctionExpression,
  BlockStatement,
  FunctionDeclaration,
  FunctionExpression,
  Node,
  Statement,
} from "@babel/types";

import {
  type ClassifiedStatement,
  classifyStatement,
} from "../evaluator/side-effect-classifier.js";
import type { SourceLocation } from "../types/finding.js";
import type { WebhookEvidence } from "../types/handler.js";
import type { ProviderCatalog } from "../types/rule-set.js";

export interface CollectVerifyOrderingInput {
  // The handler body node from CandidateHandler. Typed as `unknown` to match
  // the upstream `handler_body_node: unknown` field; we type-narrow here.
  readonly handler_body_node: unknown;
  // The location to attach to emitted evidence — typically the handler's own
  // location (where the bug "is" from the user's perspective).
  readonly location: SourceLocation;
  // Provider catalog. We read sdk_verify_calls + db_sink_calls /
  // http_sink_calls / event_sink_calls / notification_sink_calls /
  // provider_api_hosts to build the classifier inputs.
  readonly providerCatalog: ProviderCatalog;
  // Resolved provider name on this handler (or "unknown"). Determines which
  // catalog row's sink lists drive classification. "unknown" → empty sink set
  // → no evidence emitted (we never speculate a provider).
  readonly provider: string;
  // Reachable-symbols qualified names from computeReachableSymbols — folded
  // into verificationCallNames so a verification helper one call deep is
  // treated as verification, not "no verify in handler body".
  readonly reachable_qnames: ReadonlySet<string>;
}

export function collectVerifyOrderingEvidence(
  input: CollectVerifyOrderingInput,
): ReadonlyArray<WebhookEvidence> {
  // Type-narrow handler_body_node to a JS/TS function-shaped node. Anything
  // else (PHP/Python AST nodes) returns no evidence — VAS-01 covers JS/TS at
  // v0.7.0 only.
  const statements = extractTopLevelStatements(input.handler_body_node);
  if (statements === null || statements.length === 0) {
    return [];
  }

  // Build classifier inputs from the catalog entry for this provider.
  // Unknown provider → no sink set → no emit.
  const entry = input.providerCatalog[input.provider];
  if (entry === undefined) {
    return [];
  }

  const verificationCallNames = buildVerificationSet(
    entry.sdk_verify_calls,
    input.reachable_qnames,
  );
  const t1SideEffectNames = unionOf(
    entry.db_sink_calls,
    entry.http_sink_calls,
    entry.event_sink_calls,
  );
  const t2SideEffectNames = setOf(entry.notification_sink_calls);
  // provider_api_hosts is a list of hostnames, not call names; outbound HTTP
  // calls to these hosts shouldn't count as side effects. The handler-cfg
  // classifier consumes safeCallNames (qualified names) for simple exclusion.
  // Host-URL matching is a richer check that lives in the rule predicate.
  // For v0.7.0 we leave safeCallNames empty here.

  // Walk linearly. The moment we see a verification statement, stop emitting
  // side_effect_before_verify (any later side effect is fine — the spec is
  // "verify BEFORE side effects").
  const out: WebhookEvidence[] = [];
  let seenVerify = false;
  for (const stmt of statements) {
    if (seenVerify) break;
    const cls: ClassifiedStatement = classifyStatement({
      statement: stmt,
      verificationCallNames,
      t1SideEffectNames,
      t2SideEffectNames,
    });
    if (cls.kind === "verification") {
      seenVerify = true;
      continue;
    }
    if (cls.kind === "side_effect" && cls.detail !== null) {
      out.push({
        kind: "side_effect_before_verify",
        provider: input.provider,
        location: input.location,
        detail: cls.detail,
      });
    }
    // short_circuit and neutral don't emit evidence here — short_circuit is a
    // signal consumed by the test-mode-bypass rule (BYP-01) and emitted via
    // a separate evidence kind in its own phase if/when added.
  }
  return out;
}

// Type-narrow handler_body_node to a list of top-level Statements when it's a
// JS/TS function-shaped node. Returns null for anything else.
function extractTopLevelStatements(node: unknown): ReadonlyArray<Statement> | null {
  if (!isAstNode(node)) return null;
  // Babel function shapes: FunctionDeclaration / FunctionExpression /
  // ArrowFunctionExpression. ArrowFunctionExpression's body may be either
  // a BlockStatement OR an Expression (arrow with implicit return — single
  // expression body, no top-level statements to classify).
  switch (node.type) {
    case "FunctionDeclaration":
    case "FunctionExpression": {
      const fn = node as FunctionDeclaration | FunctionExpression;
      return fn.body.body;
    }
    case "ArrowFunctionExpression": {
      const arrow = node as ArrowFunctionExpression;
      if (arrow.body.type === "BlockStatement") {
        return (arrow.body as BlockStatement).body;
      }
      return [];
    }
    case "BlockStatement": {
      return (node as BlockStatement).body;
    }
    default:
      return null;
  }
}

function isAstNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type: unknown }).type === "string"
  );
}

// Build the set of call names that count as verification. We accept:
//   1. The catalog's sdk_verify_calls (e.g. "webhooks.constructEvent")
//   2. Every reachable qname that suffix-matches a sdk_verify_call
//   3. The FIRST identifier of every such reachable qname (so a helper-call
//      site whose body transitively reaches verify is treated as verification).
//
// Example: sdk_verify_calls=["webhooks.constructEvent"],
//          reachable_qnames={"verifyWebhook.webhooks.constructEvent"}
//   → add "webhooks.constructEvent" (from 1)
//   → add "verifyWebhook.webhooks.constructEvent" (from 2)
//   → add "verifyWebhook" (from 3 — the handler calls verifyWebhook(req,sig)
//     and the statement's qname resolves to just "verifyWebhook").
function buildVerificationSet(
  sdkVerifyCalls: ReadonlyArray<string>,
  reachableQnames: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const c of sdkVerifyCalls) {
    out.add(c);
  }
  for (const q of reachableQnames) {
    for (const c of sdkVerifyCalls) {
      if (q === c || q.endsWith(`.${c}`)) {
        out.add(q);
        // Helper-name extraction: the first dot-segment is the call site name
        // at the handler statement level (qualifiedCallName resolves
        // "verifyWebhook(...)" → "verifyWebhook", not the full chain).
        const firstDot = q.indexOf(".");
        if (firstDot > 0) {
          out.add(q.slice(0, firstDot));
        }
      }
    }
  }
  return out;
}

function setOf(names: ReadonlyArray<string> | undefined): Set<string> {
  return new Set(names ?? []);
}

function unionOf(
  a: ReadonlyArray<string> | undefined,
  b: ReadonlyArray<string> | undefined,
  c: ReadonlyArray<string> | undefined,
): Set<string> {
  const out = new Set<string>();
  for (const list of [a, b, c]) {
    if (list === undefined) continue;
    for (const n of list) out.add(n);
  }
  return out;
}
