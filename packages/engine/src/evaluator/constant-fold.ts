// Constant folding for numeric expressions. Used by the replay-window-too-permissive
// rule class (RPL-01) to evaluate tolerance literals like `5 * 60 * 1000` → 300000ms,
// `60 * 60` → 3600s, or `3600 * 1000` → 3600000ms before comparing against the
// per-provider `replay_tolerance_max_seconds` catalog field.
//
// Scope is intentionally narrow: arithmetic over NumericLiteral nodes only, no
// identifier resolution (a single-hop `const X = 300; ... > X * 1000` requires a
// caller to resolve `X` first), no Math.* functions, no parentheses-as-precedence
// (the AST already encodes operator precedence).
//
// This module is PURE — no I/O, no global state, no side effects. Engine-purity
// dependency-cruiser test enforces this at build time.

import type { Expression, Node } from "@babel/types";

export interface FoldResult {
  // The folded numeric value, if every leaf in the expression resolved to a
  // NumericLiteral and every operator is supported. `null` means the
  // expression contains a non-literal leaf, an unsupported operator, or a
  // computed result that isn't a finite number.
  readonly value: number | null;
  // Whether folding reached every leaf. Useful for callers that want to know
  // "did we look at the whole expression?" vs "did we fail partway through?".
  readonly resolved: boolean;
}

const SUPPORTED_BINARY_OPS = new Set(["+", "-", "*", "/", "%", "**"]);
const SUPPORTED_UNARY_OPS = new Set(["+", "-"]);

export function foldNumericExpression(node: Node | null | undefined): FoldResult {
  if (node === null || node === undefined) {
    return { value: null, resolved: false };
  }
  return foldExpression(node as Expression);
}

function foldExpression(expr: Expression): FoldResult {
  switch (expr.type) {
    case "NumericLiteral":
      return { value: expr.value, resolved: true };
    case "UnaryExpression": {
      if (!SUPPORTED_UNARY_OPS.has(expr.operator)) {
        return { value: null, resolved: false };
      }
      const inner = foldExpression(expr.argument);
      if (inner.value === null) {
        return { value: null, resolved: false };
      }
      const v = expr.operator === "-" ? -inner.value : inner.value;
      return { value: v, resolved: true };
    }
    case "BinaryExpression": {
      if (!SUPPORTED_BINARY_OPS.has(expr.operator)) {
        return { value: null, resolved: false };
      }
      // BinaryExpression.left is `Expression | PrivateName` in Babel. PrivateName
      // (e.g. #x) is never numeric, so fail loudly rather than guess.
      if (expr.left.type === "PrivateName") {
        return { value: null, resolved: false };
      }
      const left = foldExpression(expr.left);
      const right = foldExpression(expr.right);
      if (left.value === null || right.value === null) {
        return { value: null, resolved: false };
      }
      const result = applyBinaryOp(expr.operator, left.value, right.value);
      if (result === null || !Number.isFinite(result)) {
        return { value: null, resolved: false };
      }
      return { value: result, resolved: true };
    }
    case "ParenthesizedExpression":
      // Babel preserves parens as a wrapper node when `createParenthesizedExpressions`
      // is enabled. Otherwise the AST already encodes precedence and we never see
      // this. Either way, just recurse into the inner expression.
      return foldExpression(expr.expression);
    default:
      // Any other expression shape — identifiers, calls, template literals,
      // member access — is out of scope for constant folding.
      return { value: null, resolved: false };
  }
}

function applyBinaryOp(op: string, a: number, b: number): number | null {
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      // Division by zero yields Infinity which Number.isFinite filters out
      // at the call site; explicit guard here returns null for clarity.
      return b === 0 ? null : a / b;
    case "%":
      return b === 0 ? null : a % b;
    case "**":
      return a ** b;
    default:
      return null;
  }
}
