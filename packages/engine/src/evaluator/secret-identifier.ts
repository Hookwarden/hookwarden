// Classifies how a webhook secret flows into a logging or error call. Used by
// the secret-in-log-or-error rule class (LEAK-01) to distinguish the bug shape
// (value emitted into a log/error sink) from defensible patterns (boolean
// derived from secret, length check, hash, small slice).
//
// The classifier never resolves identifiers itself — it operates on argument
// expressions whose identifier-of-interest has already been resolved by the
// caller. The caller passes the leaf identifier name (e.g. "WEBHOOK_SECRET"
// or "secret"); this module reports how that identifier appears within the
// argument expression: bare value, template-interpolated, hashed, etc.
//
// 9-shape classifier per the PITFALLS research (one-per-pattern naming):
//   "bare"             - identifier appears as a top-level expression       → FIRES (value leaked)
//   "template"         - identifier inside a TemplateLiteral expression     → FIRES (value interpolated)
//   "concat"           - identifier in a string concatenation (+)            → FIRES (value concatenated)
//   "to-string"        - identifier.toString() / String(identifier)         → FIRES (value stringified)
//   "json"             - JSON.stringify(identifier)                          → FIRES (value serialized)
//   "boolean"          - !!identifier / Boolean(identifier)                  → SILENT (boolean only)
//   "length"           - identifier.length                                   → SILENT (length only)
//   "hash"             - sha256(identifier) / hash(identifier) / crypto.*    → SILENT (hashed)
//   "slice"            - identifier.slice(0, N) where N ≤ 8                  → MANUAL-REVIEW (partial; auditor judgment)
//   "absent"           - identifier never appears in the expression          → SILENT (no leak)
//
// This module is PURE — no I/O, no global state.

import type { Expression, Node } from "@babel/types";

export type SecretShape =
  | "bare"
  | "template"
  | "concat"
  | "to-string"
  | "json"
  | "boolean"
  | "length"
  | "hash"
  | "slice"
  | "absent";

export type SecretShapeVerdict = "fires" | "silent" | "manual-review";

export interface ClassifyInput {
  // The expression to inspect (typically a CallExpression argument).
  readonly expression: Node;
  // The identifier name that represents the secret (already resolved by caller).
  // The classifier looks for Identifier nodes with this exact name.
  readonly secretName: string;
  // Optional maximum slice length that downgrades to manual-review. Defaults to 8.
  readonly safeSliceMax?: number;
}

const SAFE_SLICE_DEFAULT = 8;
const HASH_CALL_HINTS = new Set([
  "sha1",
  "sha256",
  "sha512",
  "md5",
  "hash",
  "createHash",
  "createHmac",
  "digest",
  "hmac",
  "Hash",
  "Hmac",
]);

export function classifySecretShape(input: ClassifyInput): {
  shape: SecretShape;
  verdict: SecretShapeVerdict;
} {
  const safeSliceMax = input.safeSliceMax ?? SAFE_SLICE_DEFAULT;
  const shape = walkExpression(input.expression, input.secretName, safeSliceMax);
  return { shape, verdict: verdictFor(shape) };
}

function verdictFor(shape: SecretShape): SecretShapeVerdict {
  switch (shape) {
    case "bare":
    case "template":
    case "concat":
    case "to-string":
    case "json":
      return "fires";
    case "boolean":
    case "length":
    case "hash":
    case "absent":
      return "silent";
    case "slice":
      return "manual-review";
  }
}

function walkExpression(node: Node, secretName: string, safeSliceMax: number): SecretShape {
  // 1. Bare identifier reference at top level.
  if (isSecretIdentifier(node, secretName)) {
    return "bare";
  }

  // 2. Defensible wrappers checked BEFORE template/concat so they win the
  //    classification when both could apply (e.g. console.log(`hash=${sha256(secret)}`)
  //    classifies as "template" + "hash" combined — we want the strictest:
  //    if every secret reference is wrapped in a hash, the call is silent).
  if (isHashWrapper(node, secretName)) {
    return "hash";
  }
  if (isBooleanWrapper(node, secretName)) {
    return "boolean";
  }
  if (isLengthAccess(node, secretName)) {
    return "length";
  }
  const slice = isSliceCall(node, secretName);
  if (slice !== null) {
    return slice.length <= safeSliceMax ? "slice" : "bare";
  }

  // 3. Strict-fires shapes — value escapes.
  if (isToStringCall(node, secretName)) {
    return "to-string";
  }
  if (isJsonStringify(node, secretName)) {
    return "json";
  }

  // 4. Container shapes — TemplateLiteral / concat / BinaryExpression +
  //    recurse into operands. If any operand is a bare reference to the secret
  //    AND no enclosing safe wrapper exists, the whole shape is template/concat.
  if (node.type === "TemplateLiteral") {
    for (const expr of node.expressions) {
      const inner = walkExpression(expr, secretName, safeSliceMax);
      if (inner === "bare" || inner === "to-string" || inner === "json") {
        return "template";
      }
      if (inner === "template" || inner === "concat") {
        return "template";
      }
    }
    return "absent";
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    if (node.left.type === "PrivateName") {
      // PrivateName can't reference a webhook secret in any sensible scope.
    } else {
      const left = walkExpression(node.left, secretName, safeSliceMax);
      const right = walkExpression(node.right, secretName, safeSliceMax);
      if (
        left === "bare" ||
        right === "bare" ||
        left === "to-string" ||
        right === "to-string" ||
        left === "json" ||
        right === "json"
      ) {
        return "concat";
      }
      if (left === "concat" || right === "concat" || left === "template" || right === "template") {
        return "concat";
      }
    }
  }

  // 5. Default: secret didn't appear.
  return "absent";
}

function isSecretIdentifier(node: Node, secretName: string): boolean {
  return node.type === "Identifier" && node.name === secretName;
}

function isBooleanWrapper(node: Node, secretName: string): boolean {
  // !!secret  →  UnaryExpression(!, UnaryExpression(!, Identifier))
  if (
    node.type === "UnaryExpression" &&
    node.operator === "!" &&
    node.argument.type === "UnaryExpression" &&
    node.argument.operator === "!" &&
    isSecretIdentifier(node.argument.argument, secretName)
  ) {
    return true;
  }
  // Boolean(secret)
  if (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "Boolean" &&
    node.arguments.length === 1 &&
    isSecretIdentifier(node.arguments[0] as Node, secretName)
  ) {
    return true;
  }
  return false;
}

function isLengthAccess(node: Node, secretName: string): boolean {
  return (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.property.type === "Identifier" &&
    node.property.name === "length" &&
    isSecretIdentifier(node.object, secretName)
  );
}

function isSliceCall(node: Node, secretName: string): { length: number } | null {
  if (node.type !== "CallExpression") return null;
  if (node.callee.type !== "MemberExpression") return null;
  if (node.callee.computed) return null;
  if (node.callee.property.type !== "Identifier") return null;
  const method = node.callee.property.name;
  if (method !== "slice" && method !== "substring" && method !== "substr") return null;
  if (!isSecretIdentifier(node.callee.object, secretName)) return null;
  // Find the largest numeric literal among the call's numeric args; that's
  // the worst-case slice length we accept as "small partial reveal".
  let maxLen = 0;
  for (const arg of node.arguments) {
    if ((arg as Node).type === "NumericLiteral") {
      const v = (arg as { value: number }).value;
      if (v > maxLen) maxLen = v;
    }
  }
  return { length: maxLen };
}

function isToStringCall(node: Node, secretName: string): boolean {
  // identifier.toString()
  if (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === "toString" &&
    isSecretIdentifier(node.callee.object, secretName)
  ) {
    return true;
  }
  // String(identifier)
  if (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "String" &&
    node.arguments.length >= 1 &&
    isSecretIdentifier(node.arguments[0] as Node, secretName)
  ) {
    return true;
  }
  return false;
}

function isJsonStringify(node: Node, secretName: string): boolean {
  if (node.type !== "CallExpression") return false;
  if (node.callee.type !== "MemberExpression") return false;
  if (node.callee.computed) return false;
  if (node.callee.object.type !== "Identifier" || node.callee.object.name !== "JSON") return false;
  if (node.callee.property.type !== "Identifier" || node.callee.property.name !== "stringify") {
    return false;
  }
  return node.arguments.some((arg) => isSecretIdentifier(arg as Node, secretName));
}

function isHashWrapper(node: Node, secretName: string): boolean {
  if (node.type !== "CallExpression") return false;
  const calleeName = extractCalleeName(node.callee as Expression);
  if (calleeName === null) return false;
  if (!HASH_CALL_HINTS.has(calleeName)) return false;
  return node.arguments.some((arg) => isSecretIdentifier(arg as Node, secretName));
}

function extractCalleeName(callee: Expression): string | null {
  if (callee.type === "Identifier") return callee.name;
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier"
  ) {
    return callee.property.name;
  }
  return null;
}
