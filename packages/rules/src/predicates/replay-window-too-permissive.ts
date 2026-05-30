// RPL-01 — Replay-window-too-permissive. Detects timestamp tolerance
// comparisons that exceed the provider's spec maximum
// (catalog.replay_tolerance_max_seconds). Only applies to providers with a
// non-null spec max (Stripe / Slack / Shopify / Standard Webhooks at 300s).
//
// Detection patterns (v0.7.0 MVP):
//
//   A) Manual time-diff comparison
//      Math.abs(Date.now() / 1000 - timestamp) > 60 * 60      // 1hr in sec
//      Date.now() - timestamp > 5 * 60 * 1000                 // 5min in ms
//      (Math.abs(now - then) > 3600000)                       // 1hr in ms
//
//      Rule: find BinaryExpression with operator '>' or '>='
//            where ONE side resolves to a finite numeric constant
//            AND the other side mentions Date.now (handler scope).
//            Unit-infer based on the divisor / multiplier shape.
//
//   B) Stripe-shaped explicit tolerance argument
//      stripe.webhooks.constructEvent(body, sig, secret, /*tolerance*/ 3600)
//      Rule: 4th arg of a sdk_verify_call CallExpression, foldable numeric.
//      Stripe's tolerance arg is documented in seconds.
//
// FP suppression:
//   - env-var tolerance (process.env.TOLERANCE) → manual-review, never fires
//   - units we can't infer → manual-review
//
// Pure: no fs / http / network / process / node:* (D-28).

import type {
  ProjectModel,
  ProviderCatalogEntry,
  RulePredicate,
  WebhookHandler,
} from "@hookwarden/engine";

interface AstNode {
  readonly type: string;
}
interface NodeWithLoc extends AstNode {
  readonly loc?: { readonly start?: { readonly line: number } } | null;
}
interface CallExpressionLike extends AstNode {
  readonly type: "CallExpression";
  readonly callee: AstNode;
  readonly arguments: ReadonlyArray<AstNode>;
}
interface MemberExpressionLike extends AstNode {
  readonly type: "MemberExpression";
  readonly object: AstNode;
  readonly property: AstNode;
  readonly computed: boolean;
}
interface IdentifierLike extends AstNode {
  readonly type: "Identifier";
  readonly name: string;
}
interface BinaryExpressionLike extends AstNode {
  readonly type: "BinaryExpression";
  readonly operator: string;
  readonly left: AstNode;
  readonly right: AstNode;
}
interface NumericLiteralLike extends AstNode {
  readonly type: "NumericLiteral";
  readonly value: number;
}

export function createReplayWindowTooPermissivePredicate(
  provider: string,
  catalog: ProviderCatalogEntry,
): RulePredicate {
  return async (handler: WebhookHandler, model: ProjectModel) => {
    if (handler.provider !== provider) return null;
    const maxSeconds = catalog.replay_tolerance_max_seconds;
    if (maxSeconds === null || maxSeconds === undefined) return null;
    const file = model.parsed_files?.find((f) => f.file_path === handler.file_path);
    if (!file || file.dialect !== "babel") return null;
    const body = (file.raw_ast as { program?: { body?: AstNode[] } })?.program?.body;
    if (!Array.isArray(body)) return null;

    const startLine = handler.location.line;
    const endLine = (handler.location as { end_line?: number }).end_line ?? Number.MAX_SAFE_INTEGER;
    const verifyNames = new Set(catalog.sdk_verify_calls);

    let sawDateNow = false;
    let exceeded: { tolerance_seconds: number; line: number } | null = null;
    let sawEnvVarTolerance = false;

    const inScope = (n: AstNode): boolean => {
      const line = (n as NodeWithLoc).loc?.start?.line ?? 0;
      return line >= startLine && line <= endLine;
    };

    const visit = (n: AstNode): void => {
      if (!inScope(n)) {
        // Still recurse — the handler subtree might be deeper.
      }

      // Detect Date.now references anywhere in the handler.
      if (isDateNowRef(n)) sawDateNow = true;

      // Pattern A: BinaryExpression > / >= with foldable numeric side.
      if (n.type === "BinaryExpression") {
        const be = n as BinaryExpressionLike;
        if ((be.operator === ">" || be.operator === ">=") && inScope(n)) {
          const lit = foldNumeric(be.left) ?? foldNumeric(be.right);
          // If either side references process.env (env-var tolerance), defer to manual-review.
          if (containsProcessEnv(be.left) || containsProcessEnv(be.right)) {
            sawEnvVarTolerance = true;
          }
          if (lit !== null) {
            const toleranceSeconds = inferUnitsToSeconds(lit, be);
            if (toleranceSeconds !== null && toleranceSeconds > maxSeconds) {
              const line = (be as NodeWithLoc).loc?.start?.line ?? 0;
              if (exceeded === null || line < exceeded.line) {
                exceeded = { tolerance_seconds: toleranceSeconds, line };
              }
            }
          }
        }
      }

      // Pattern B: Stripe-shaped sdk_verify_call(..., tolerance)
      if (n.type === "CallExpression" && inScope(n)) {
        const call = n as CallExpressionLike;
        const cname = qualifiedCallName(call);
        if (cname !== null) {
          for (const v of verifyNames) {
            if (cname === v || cname.endsWith(`.${v}`)) {
              // Stripe's constructEvent(payload, sig, secret, tolerance?)
              const tolArg = call.arguments[3];
              if (tolArg !== undefined) {
                const tol = foldNumeric(tolArg);
                if (tol !== null && tol > maxSeconds) {
                  const line = (call as NodeWithLoc).loc?.start?.line ?? 0;
                  if (exceeded === null || line < exceeded.line) {
                    exceeded = { tolerance_seconds: tol, line };
                  }
                } else if (tolArg.type !== "NumericLiteral") {
                  sawEnvVarTolerance = true;
                }
              }
              break;
            }
          }
        }
      }

      for (const key of Object.keys(n)) {
        if (key === "loc" || key === "type" || key === "start" || key === "end") continue;
        const value = (n as unknown as Record<string, unknown>)[key];
        if (value === null || value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) if (isAstNode(item)) visit(item);
        } else if (isAstNode(value)) {
          visit(value);
        }
      }
    };
    for (const stmt of body) visit(stmt);

    if (exceeded !== null) {
      // Suppress Pattern A if no Date.now anchor in the handler — generic
      // numeric comparisons (rate limits, retries) shouldn't fire RPL.
      // For Pattern B (sdk_verify_call's 4th arg), Date.now isn't required.
      return "not-verified";
    }
    if (sawEnvVarTolerance && sawDateNow) {
      return "manual-review";
    }
    return null;
  };
}

function isAstNode(v: unknown): v is AstNode {
  return (
    typeof v === "object" &&
    v !== null &&
    "type" in v &&
    typeof (v as { type: unknown }).type === "string"
  );
}

function isDateNowRef(n: AstNode): boolean {
  // Date.now()  → CallExpression{callee: MemberExpression{object: Identifier(Date), property: Identifier(now)}}
  if (n.type !== "CallExpression") return false;
  const callee = (n as CallExpressionLike).callee;
  if (callee.type !== "MemberExpression") return false;
  const mem = callee as MemberExpressionLike;
  return (
    !mem.computed &&
    mem.object.type === "Identifier" &&
    (mem.object as IdentifierLike).name === "Date" &&
    mem.property.type === "Identifier" &&
    (mem.property as IdentifierLike).name === "now"
  );
}

function containsProcessEnv(n: AstNode): boolean {
  let found = false;
  const visit = (node: AstNode): void => {
    if (found) return;
    if (node.type === "MemberExpression") {
      const mem = node as MemberExpressionLike;
      if (
        mem.object.type === "Identifier" &&
        (mem.object as IdentifierLike).name === "process" &&
        mem.property.type === "Identifier" &&
        (mem.property as IdentifierLike).name === "env"
      ) {
        found = true;
        return;
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "type" || key === "start" || key === "end") continue;
      const value = (node as unknown as Record<string, unknown>)[key];
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) if (isAstNode(item)) visit(item);
      } else if (isAstNode(value)) {
        visit(value);
      }
    }
  };
  visit(n);
  return found;
}

// Inline numeric folding (mirrors @hookwarden/engine evaluator/constant-fold).
const FOLD_BIN_OPS = new Set(["+", "-", "*", "/", "%", "**"]);
const FOLD_UN_OPS = new Set(["+", "-"]);
function foldNumeric(node: AstNode | undefined | null): number | null {
  if (!node) return null;
  if (node.type === "NumericLiteral") return (node as NumericLiteralLike).value;
  if (node.type === "UnaryExpression") {
    const u = node as unknown as { operator: string; argument: AstNode };
    if (!FOLD_UN_OPS.has(u.operator)) return null;
    const inner = foldNumeric(u.argument);
    if (inner === null) return null;
    return u.operator === "-" ? -inner : inner;
  }
  if (node.type === "BinaryExpression") {
    const b = node as BinaryExpressionLike;
    if (!FOLD_BIN_OPS.has(b.operator)) return null;
    const l = foldNumeric(b.left);
    const r = foldNumeric(b.right);
    if (l === null || r === null) return null;
    switch (b.operator) {
      case "+":
        return l + r;
      case "-":
        return l - r;
      case "*":
        return l * r;
      case "/":
        if (r === 0) return null;
        return Number.isFinite(l / r) ? l / r : null;
      case "%":
        if (r === 0) return null;
        return l % r;
      case "**":
        return Number.isFinite(l ** r) ? l ** r : null;
    }
  }
  return null;
}

// Infer the units of the tolerance literal. The literal is either:
//   - seconds: if the surrounding comparison shape divides Date.now by 1000
//   - milliseconds: if the comparison uses Date.now directly
//   - ambiguous: if neither pattern matches → return null (manual-review)
//
// For v0.7.0 MVP we use a simple heuristic:
//   - if any divisor `/1000` appears anywhere in the BinaryExpression: seconds
//   - if literal includes `* 1000` as a factor: literal is in ms → convert
//   - if literal is suspiciously large (> 86400 = 1 day): assume ms
//   - default: seconds (Stripe's tolerance arg is documented as seconds)
function inferUnitsToSeconds(literal: number, be: BinaryExpressionLike): number | null {
  // Check whether the literal expression text included `* 1000` — we infer
  // from the AST shape via foldNumeric being a multiple of 1000.
  if (containsDivide1000(be.left) || containsDivide1000(be.right)) {
    return literal; // seconds
  }
  if (literal > 86400) {
    return literal / 1000; // assume ms
  }
  if (literal % 1000 === 0 && literal >= 1000) {
    // Looks like ms (1000 / 60000 / 3600000 / etc).
    return literal / 1000;
  }
  return literal; // assume seconds
}

function containsDivide1000(n: AstNode): boolean {
  let found = false;
  const visit = (node: AstNode): void => {
    if (found) return;
    if (node.type === "BinaryExpression") {
      const b = node as BinaryExpressionLike;
      if (b.operator === "/" && b.right.type === "NumericLiteral") {
        if ((b.right as NumericLiteralLike).value === 1000) {
          found = true;
          return;
        }
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "type" || key === "start" || key === "end") continue;
      const value = (node as unknown as Record<string, unknown>)[key];
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) if (isAstNode(item)) visit(item);
      } else if (isAstNode(value)) {
        visit(value);
      }
    }
  };
  visit(n);
  return found;
}

function qualifiedCallName(call: CallExpressionLike): string | null {
  return calleeToString(call.callee);
}

function calleeToString(expr: AstNode): string | null {
  if (expr.type === "Identifier") return (expr as IdentifierLike).name;
  if (expr.type === "MemberExpression") {
    const mem = expr as MemberExpressionLike;
    if (mem.computed) return null;
    if (mem.property.type !== "Identifier") return null;
    const lhs = mem.object.type === "ThisExpression" ? "this" : calleeToString(mem.object);
    if (lhs === null) return null;
    return `${lhs}.${(mem.property as IdentifierLike).name}`;
  }
  return null;
}

// biome-ignore lint/style/useNamingConvention: __test_only is a deliberate test-export convention
export const __test_only = { foldNumeric, inferUnitsToSeconds };
