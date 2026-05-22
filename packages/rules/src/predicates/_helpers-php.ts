// Phase 8.1 Plan 08 — shared PHP AST helpers for predicate authors.
// Mirrors `_helpers.ts` API surface for PHP source. Pure: no fs / http / network / process /
// node:* (D-28 + .dependency-cruiser rules-predicates-no-node-core).
//
// The rules package cannot import from engine internals (D-23 + dep-cruiser rules-no-engine-internal),
// so tree-walking helpers live here and re-declare the tree-sitter-php SyntaxNode structural
// shape rather than coupling to web-tree-sitter's exported types.

import type { ReachableSymbol } from "@hookwarden/engine";

export interface PhpSyntaxNode {
  readonly type: string;
  readonly text: string;
  readonly startPosition: { readonly row: number; readonly column: number };
  readonly endPosition: { readonly row: number; readonly column: number };
  readonly namedChildren: ReadonlyArray<PhpSyntaxNode>;
  childForFieldName(name: string): PhpSyntaxNode | null;
  descendantsOfType(types: string | ReadonlyArray<string>): ReadonlyArray<PhpSyntaxNode>;
}

export interface PhpTree {
  readonly rootNode: PhpSyntaxNode;
}

// PHP's `hash_hmac` is the canonical manual-HMAC entry point. The qualified-name form may
// surface with a leading `\\` (root-namespace marker) — strip it before comparison.
export function isPhpManualHmacEntry(name: string): boolean {
  const n = name.startsWith("\\") ? name.slice(1) : name;
  return n === "hash_hmac";
}

// PHP's `hash_equals` is the constant-time string-compare since PHP 5.6. The only safe form
// for HMAC comparison in PHP.
export function isPhpHashEqualsCall(name: string): boolean {
  const n = name.startsWith("\\") ? name.slice(1) : name;
  return n === "hash_equals";
}

// `strcmp` and `strcasecmp` are PHP's general-purpose string-compare functions. They are NOT
// constant-time — `strcmp(expected, provided) === 0` leaks timing information just like
// `expected === provided`.
export function isPhpStrcmpCall(name: string): boolean {
  const n = name.startsWith("\\") ? name.slice(1) : name;
  return n === "strcmp" || n === "strcasecmp";
}

// Variable names that signal "this is signature material" — used by findInsecureStringComparisons
// to filter out generic equality checks (e.g. `if ($x === 'yes')`).
const SIGNATURE_VAR_RE = /\b(sig|signature|hmac|digest|expected|computed|provided)\b/i;

export interface InsecureComparison {
  readonly operator: "==" | "===" | "strcmp";
  readonly location: { readonly line: number; readonly col: number };
  readonly text: string;
}

// Walks a tree-sitter-php tree (or any subtree) for the D-09 PHP timing-unsafe patterns:
//   1. `$expected === $sig` / `$expected == $sig` where at least one operand looks like
//      signature material
//   2. `strcmp($expected, $sig) === 0` / `strcasecmp(...) === 0` (a uniquely-PHP case —
//      developers reach for strcmp expecting a comparison helper, but it's not constant-time)
//
// Pattern (2) is matched textually inside the binary_expression's operand check rather than
// via tree-walking the function_call_expression separately — the operand IS the call.
export function findInsecureStringComparisons(
  root: PhpSyntaxNode,
): ReadonlyArray<InsecureComparison> {
  const out: InsecureComparison[] = [];
  for (const expr of root.descendantsOfType(["binary_expression"])) {
    const op = extractBinaryOperator(expr);
    if (op !== "==" && op !== "===") continue;
    const operands = expr.namedChildren.filter(
      (c) => c.type !== "==" && c.type !== "===" && c.type !== "!=" && c.type !== "!==",
    );
    if (operands.length < 2) continue;
    const left = operands[0];
    const right = operands[1];
    if (!left || !right) continue;

    // strcmp/strcasecmp variant: one side is a function_call_expression to strcmp, other is 0.
    if (isStrcmpVsZero(left, right) || isStrcmpVsZero(right, left)) {
      out.push({
        operator: "strcmp",
        location: { line: expr.startPosition.row + 1, col: expr.startPosition.column + 1 },
        text: expr.text,
      });
      continue;
    }

    // Plain equality vs signature-shaped variable.
    if (SIGNATURE_VAR_RE.test(left.text) || SIGNATURE_VAR_RE.test(right.text)) {
      out.push({
        operator: op,
        location: { line: expr.startPosition.row + 1, col: expr.startPosition.column + 1 },
        text: expr.text,
      });
    }
  }
  return out;
}

function extractBinaryOperator(expr: PhpSyntaxNode): string | null {
  // tree-sitter-php exposes the operator token as an unnamed child. Field-name lookup is the
  // grammar-agnostic way: `operator` field returns the operator token.
  const opNode = expr.childForFieldName("operator");
  if (opNode) return opNode.text;
  // Fallback — scan the literal text. The first run of `=`, `!`, `<`, `>`, `&`, `|`, `^` etc.
  // is the operator. Cheap; bounded by the original expr.text length.
  const m = expr.text.match(/(===|!==|==|!=|<=>|<=|>=|<<|>>|\?\?|&&|\|\||[+\-*/%.<>&|^?])/);
  return m?.[1] ?? null;
}

function isStrcmpVsZero(callSide: PhpSyntaxNode, zeroSide: PhpSyntaxNode): boolean {
  if (callSide.type !== "function_call_expression") return false;
  const fn = callSide.childForFieldName("function");
  if (!fn || (fn.text !== "strcmp" && fn.text !== "strcasecmp")) return false;
  // Allow either a `\strcmp` leading-backslash form or bare form.
  if (zeroSide.text !== "0") return false;
  return true;
}

export interface PhpCallSite {
  readonly node: PhpSyntaxNode;
  readonly text: string;
  readonly kind: "function" | "member" | "scoped";
}

// Iterate all PHP call sites under `root` — function_call_expression (`hash_hmac(...)`),
// member_call_expression (`$obj->method(...)`), scoped_call_expression (`Class::method(...)`).
export function walkPhpCalls(root: PhpSyntaxNode): ReadonlyArray<PhpCallSite> {
  const out: PhpCallSite[] = [];
  for (const n of root.descendantsOfType([
    "function_call_expression",
    "member_call_expression",
    "scoped_call_expression",
  ])) {
    const kind: PhpCallSite["kind"] =
      n.type === "function_call_expression"
        ? "function"
        : n.type === "member_call_expression"
          ? "member"
          : "scoped";
    out.push({ node: n, text: n.text, kind });
  }
  return out;
}

// PHP reachability is bounded by Phase 8.1 v1 — the engine reach pass currently only walks
// babel + tree-sitter-python. PHP handlers surface their verify-call signal through the
// build.ts PHP overlay (Phase 8.1 Plan 07) which emits a `sdk_verify_call` evidence entry.
// This helper exists for API parity with `_helpers.ts:reachesSdkVerifyCall` and currently
// returns false for PHP — predicates that need PHP verify detection should consult
// `handler.evidence` directly (see library-verified-recognition Phase 8.1 Plan 08 extension).
export function reachesPhpSdkVerifyCall(
  _symbols: ReadonlyArray<ReachableSymbol>,
  _sdkVerifyCalls: ReadonlyArray<string>,
): boolean {
  return false;
}
