// Phase 27 (RULES-GO-01) — shared Go AST helpers for predicate authors.
// Mirrors `_helpers-php.ts`. Pure: no fs / http / network / process / node:* (D-28 +
// .dependency-cruiser rules-predicates-no-node-core).
//
// The rules package cannot import engine internals (D-23 + dep-cruiser rules-no-engine-internal),
// so tree-walking helpers re-declare the tree-sitter-go SyntaxNode structural shape rather than
// coupling to web-tree-sitter's exported types.
//
// THE LOAD-BEARING DISCIPLINE (Pitfall 2): in Go, `hmac.Equal` is the ONLY constant-time MAC
// comparison. `bytes.Equal` is result-correct but NOT constant-time — using it on a MAC IS the
// CWE-208 bug. Structural similarity must NOT make `bytes.Equal` look safe.

export interface GoSyntaxNode {
  readonly type: string;
  readonly text: string;
  readonly startPosition: { readonly row: number; readonly column: number };
  readonly endPosition: { readonly row: number; readonly column: number };
  readonly namedChildren: ReadonlyArray<GoSyntaxNode>;
  childForFieldName(name: string): GoSyntaxNode | null;
  descendantsOfType(types: string | ReadonlyArray<string>): ReadonlyArray<GoSyntaxNode>;
}

export interface GoTree {
  readonly rootNode: GoSyntaxNode;
}

// `hmac.Equal(macA, macB)` (crypto/hmac) is the constant-time comparison — the ONLY safe
// hand-rolled MAC compare in Go.
export function isGoHmacEqualCall(qname: string): boolean {
  return qname === "hmac.Equal";
}

// `bytes.Equal(a, b)` is a fast, NON-constant-time byte compare. On a MAC it leaks timing — the bug.
// (Pitfall 2 — do NOT let its structural resemblance to hmac.Equal mark it safe.)
export function isGoBytesEqualCall(qname: string): boolean {
  return qname === "bytes.Equal";
}

// Signature-material identifiers. Substring (NOT \b-anchored) so Go's camelCase idiom is covered:
// `expectedMAC`, `gotSig`, `computedSignature` all match.
const GO_SIGNATURE_RE = /(sig|signature|hmac|mac|digest|expected|computed|provided)/i;

export interface InsecureComparison {
  readonly operator: "==" | "!=" | "bytes.Equal";
  readonly location: { readonly line: number; readonly col: number };
  readonly text: string;
}

// The qualified name of a call: `pkg.Func` for a selector callee, or the bare identifier.
export function callQName(call: GoSyntaxNode): string | null {
  const fn = call.childForFieldName("function");
  if (!fn) return null;
  if (fn.type === "selector_expression") {
    const operand = fn.childForFieldName("operand");
    const field = fn.childForFieldName("field");
    if (!field) return null;
    return operand ? `${operand.text}.${field.text}` : field.text;
  }
  return fn.text || null;
}

// Every call_expression under `root`.
export function walkGoCalls(root: GoSyntaxNode): ReadonlyArray<GoSyntaxNode> {
  return root.descendantsOfType(["call_expression"]);
}

// Detects the two Go timing-unsafe MAC-comparison shapes (D-09 analog):
//   1. `bytes.Equal(mac, sig)` — a bytes.Equal call with a signature-shaped argument.
//   2. `string(mac) == sig` / `hex.EncodeToString(mac) == sig` / `expected == sig` — a
//      binary_expression with == / != where an operand is signature-shaped.
// `hmac.Equal(...)` is NEVER reported here (it is the safe form).
export function findInsecureMacComparisons(root: GoSyntaxNode): ReadonlyArray<InsecureComparison> {
  const out: InsecureComparison[] = [];

  // Shape 1 — bytes.Equal on a signature-shaped operand.
  for (const call of walkGoCalls(root)) {
    if (callQName(call) !== "bytes.Equal") continue;
    const args = call.childForFieldName("arguments");
    const argText = args?.text ?? "";
    if (GO_SIGNATURE_RE.test(argText)) {
      out.push({
        operator: "bytes.Equal",
        location: { line: call.startPosition.row + 1, col: call.startPosition.column + 1 },
        text: call.text,
      });
    }
  }

  // Shape 2 — == / != with a signature-shaped operand.
  for (const expr of root.descendantsOfType(["binary_expression"])) {
    const op = expr.childForFieldName("operator")?.text;
    if (op !== "==" && op !== "!=") continue;
    const left = expr.childForFieldName("left");
    const right = expr.childForFieldName("right");
    const leftText = left?.text ?? "";
    const rightText = right?.text ?? "";
    if (GO_SIGNATURE_RE.test(leftText) || GO_SIGNATURE_RE.test(rightText)) {
      out.push({
        operator: op,
        location: { line: expr.startPosition.row + 1, col: expr.startPosition.column + 1 },
        text: expr.text,
      });
    }
  }
  return out;
}

// Shared timing-unsafe verdict over a Go handler body (used by the standalone Stripe/GitHub Go
// predicates AND the factory/github Go paths so behavior is identical):
//   - hmac.Equal present anywhere → null (safe form used; conservative silence, mirrors PHP).
//   - no manual HMAC (hmac.New) present → null (the rule only applies to hand-rolled HMAC handlers).
//   - no insecure comparison → null.
//   - otherwise → "not-verified".
// NEVER returns the verified state — that is a pipeline STATE emitted by the library-verified rule, never a
// critical predicate's return value (MEMORY project_critical_rule_safe_path_must_return_null).
export function goTimingUnsafeResult(root: GoSyntaxNode): "not-verified" | null {
  const calls = walkGoCalls(root);
  if (calls.some((c) => isGoHmacEqualCall(callQName(c) ?? ""))) return null;
  if (!calls.some((c) => callQName(c) === "hmac.New")) return null;
  if (findInsecureMacComparisons(root).length === 0) return null;
  return "not-verified";
}
