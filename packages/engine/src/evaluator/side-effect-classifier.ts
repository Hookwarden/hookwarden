// Classifies statements in a webhook handler body as side_effect /
// verification / short_circuit / neutral. Used by handler-cfg.ts (v0.7
// Phase 13) to build the linear-scan CFG-lite consumed by:
//   - verify-after-side-effect (VAS-01): emits when any side_effect appears
//     BEFORE a verification statement in the linear order.
//   - test-mode-bypass (BYP-01): emits when a short_circuit (NODE_ENV check
//     + early return) appears BEFORE a verification statement.
//
// Classification is INTRA-PROCEDURAL and pattern-based. We never recurse into
// helper-function bodies — the caller (handler-cfg) resolves call targets via
// `reachable_symbols` to decide whether a CallExpression is a verification
// proxy vs a side effect.
//
// Per-call classification uses two inputs:
//   1. The CallExpression itself (member-name shape, call-name shape).
//   2. A pre-resolved catalog: which call qualified-names count as verification,
//      which count as side effects of each tier. The caller assembles this
//      from PROVIDER_CATALOG fields (sdk_verify_calls, db_sink_calls,
//      http_sink_calls, event_sink_calls, notification_sink_calls).
//
// "Tier" semantics per the FEATURES research:
//   T1 critical → "side_effect" with severity-hint "critical" (DB write,
//                 outbound HTTP non-provider, event emit)
//   T2 high     → "side_effect" with severity-hint "high" (SMS/email/push,
//                 file write outside log paths)
//   T3 not flagged — logging, telemetry. Not reported here at all (the
//                    classifier returns "neutral" for these calls).
//
// This module is PURE.

import type { CallExpression, Expression, Node, Statement } from "@babel/types";

export type StatementClass = "verification" | "side_effect" | "short_circuit" | "neutral";

export type SeverityHint = "critical" | "high" | null;

export interface ClassifyStatementInput {
  readonly statement: Statement;
  readonly verificationCallNames: ReadonlySet<string>;
  readonly t1SideEffectNames: ReadonlySet<string>;
  readonly t2SideEffectNames: ReadonlySet<string>;
  // Optional: skip these call names when classifying side effects (e.g.
  // provider's own API hosts shouldn't count as outbound side effects).
  readonly safeCallNames?: ReadonlySet<string>;
}

export interface ClassifiedStatement {
  readonly kind: StatementClass;
  readonly severity: SeverityHint;
  // Concrete call qualifier that drove the classification, when applicable.
  // Useful for evidence detail strings ("matched: prisma.user.create").
  readonly detail: string | null;
}

const NEUTRAL: ClassifiedStatement = { kind: "neutral", severity: null, detail: null };

export function classifyStatement(input: ClassifyStatementInput): ClassifiedStatement {
  // Short-circuit detection lives at the IfStatement level — any branch that
  // unconditionally returns / responds before falling through. This is a
  // structural pattern test; the caller decides whether the test condition
  // is dev-mode-gated (BYP-01) vs legitimate early-validation.
  if (input.statement.type === "IfStatement") {
    if (containsEarlyReturn(input.statement.consequent)) {
      return { kind: "short_circuit", severity: null, detail: null };
    }
  }

  // Any other statement: collect every CallExpression within and classify by
  // the strongest signal. Verification > T1 side-effect > T2 side-effect >
  // neutral. The strongest classification wins (a single statement that
  // calls verify AND a DB write is unusual but legal — classify as
  // verification so it doesn't trigger VAS-01 against itself).
  const calls = collectCallExpressions(input.statement);
  let best: ClassifiedStatement = NEUTRAL;
  for (const call of calls) {
    const qname = qualifiedCallName(call);
    if (qname === null) continue;
    if (input.safeCallNames?.has(qname)) continue;
    if (input.verificationCallNames.has(qname)) {
      return { kind: "verification", severity: null, detail: qname };
    }
    if (input.t1SideEffectNames.has(qname) && best.kind !== "side_effect") {
      best = { kind: "side_effect", severity: "critical", detail: qname };
    } else if (
      input.t2SideEffectNames.has(qname) &&
      best.kind === "neutral" /* don't downgrade a T1 hit */
    ) {
      best = { kind: "side_effect", severity: "high", detail: qname };
    }
  }
  return best;
}

// Extract the qualified call name from a CallExpression. Returns:
//   "fetch"                              for fetch(...)
//   "axios.post"                         for axios.post(...)
//   "prisma.user.create"                 for prisma.user.create(...)
//   "client.webhooks.constructEvent"     for client.webhooks.constructEvent(...)
//   null                                 for dynamic/computed callees
//
// Wildcard catalog entries like "prisma.*.create" are matched by the caller
// using a separate matcher (this module just returns the literal dotted name).
export function qualifiedCallName(call: CallExpression): string | null {
  return calleeToString(call.callee as Expression);
}

function calleeToString(expr: Expression): string | null {
  if (expr.type === "Identifier") return expr.name;
  if (expr.type === "MemberExpression" && !expr.computed) {
    if (expr.property.type !== "Identifier") return null;
    const lhs = expr.object.type === "ThisExpression" ? "this" : calleeToString(expr.object);
    if (lhs === null) return null;
    return `${lhs}.${expr.property.name}`;
  }
  return null;
}

// Walk a Statement (typically the IfStatement consequent) and report whether
// it contains an unconditional return / response-write reachable on every
// path. Used for short-circuit detection in BYP-01.
function containsEarlyReturn(node: Statement): boolean {
  if (node.type === "ReturnStatement") return true;
  if (node.type === "BlockStatement") {
    // Conservative: any top-level statement in the block that returns counts.
    for (const stmt of node.body) {
      if (stmt.type === "ReturnStatement") return true;
      if (stmt.type === "ExpressionStatement" && isResponseWriteCall(stmt.expression)) {
        // res.json(...).end() and similar — treat as terminal for BYP-01 purposes
        // since the bug shape is "respond with success without verifying".
        // The bug isn't the return itself; it's that the response is sent
        // before any verification call runs. We let handler-cfg decide whether
        // this is bypass-shaped by inspecting subsequent statements.
        return true;
      }
    }
  }
  if (node.type === "ExpressionStatement" && isResponseWriteCall(node.expression)) return true;
  return false;
}

const RESPONSE_WRITE_METHODS = new Set(["json", "send", "end", "status"]);

function isResponseWriteCall(expr: Expression): boolean {
  if (expr.type !== "CallExpression") return false;
  // Match res.json(...) / res.send(...) / res.end() / res.status(N).json(...)
  let cursor: Expression = expr.callee as Expression;
  // Unwrap a chain like res.status(200).json(...)
  while (cursor.type === "CallExpression") {
    cursor = cursor.callee as Expression;
  }
  if (cursor.type !== "MemberExpression") return false;
  if (cursor.computed) return false;
  if (cursor.property.type !== "Identifier") return false;
  return RESPONSE_WRITE_METHODS.has(cursor.property.name);
}

// Shallow walk: collect direct CallExpressions in this statement, but do NOT
// recurse into nested function/arrow bodies (those are separate scopes).
function collectCallExpressions(stmt: Statement): CallExpression[] {
  const out: CallExpression[] = [];
  visit(stmt, (n) => {
    if (n.type === "CallExpression") out.push(n);
  });
  return out;
}

function visit(node: Node, fn: (n: Node) => void): void {
  fn(node);
  for (const key of Object.keys(node) as Array<keyof Node>) {
    if (key === "loc" || key === "type" || key === "start" || key === "end") continue;
    const value = (node as unknown as Record<string, unknown>)[key as string];
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isAstNode(item) && !isFunctionScope(item)) visit(item as Node, fn);
      }
    } else if (isAstNode(value) && !isFunctionScope(value)) {
      visit(value as Node, fn);
    }
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

function isFunctionScope(node: unknown): boolean {
  if (!isAstNode(node)) return false;
  return (
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration" ||
    node.type === "ArrowFunctionExpression" ||
    node.type === "ObjectMethod" ||
    node.type === "ClassMethod"
  );
}
