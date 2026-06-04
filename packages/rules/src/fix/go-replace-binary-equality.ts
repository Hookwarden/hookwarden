// Pure: no fs / http / network / process / node:* (D-28).
//
// Phase 27 (FIX-GO-01 #1) — Go timing-unsafe-comparison codegen.
//
// Safety claim (D-11):
//   1. Local: YES (single call_expression or binary_expression range)
//   2. Semantic-preserving: YES (hmac.Equal returns bool like bytes.Equal / ==)
//   3. Strengthens security: YES (constant-time)
//   4. No new imports: USUALLY — emits importsToAdd=[{module:"crypto/hmac"}] only when absent
//      (nearly always present: the handler called hmac.New to compute the MAC)
//   5. No type errors: YES — hmac.Equal(a, b []byte) bool; operands wrapped in []byte() for the
//      == shape (identity conversion when already []byte)
//
// Two shapes (mirror the predicate's findInsecureMacComparisons):
//   bytes.Equal(mac, sig)        → hmac.Equal(mac, sig)            [callee swap; args already []byte]
//   string(mac) == sig           → hmac.Equal([]byte(mac), []byte(sig))
// `!=` is NOT auto-fixed (would need a `!hmac.Equal(...)` wrapper — defer, mirrors PHP/Python).

import type { Finding, ParsedFile } from "@hookwarden/engine";
import type { FixEdit } from "@hookwarden/fix";
import type { Node as TsNode } from "web-tree-sitter";

const ROUTINE_ID = "go-replace-binary-equality";

export function goReplaceBinaryEquality(parsedFile: ParsedFile, finding: Finding): FixEdit | null {
  if (parsedFile.dialect !== "tree-sitter-go") return null;
  if (parsedFile.parse_error !== null) return null;
  if (parsedFile.raw_ast === null || parsedFile.raw_ast === undefined) return null;
  const lineSource = sliceLine(parsedFile.source_text, finding.location.line);
  if (lineSource.includes("hmac.Equal")) return null; // already safe on this line

  const tree = parsedFile.raw_ast as { readonly rootNode: TsNode };
  const source = parsedFile.source_text;
  // The finding anchors to the handler declaration line; the insecure comparison lives somewhere in
  // the handler body. Search the handler's full line span and require a SOLE target — a safe fixer
  // never guesses which comparison is the signature check (mirrors typescript-replace-binary-equality).
  const target = findSoleFixTarget(tree.rootNode, finding.location.line);
  if (target === null) return null;

  let after: string;
  if (target.kind === "call") {
    // bytes.Equal(<args>) → hmac.Equal(<args>). Reuse the arguments node verbatim (already []byte).
    const args = target.node.childForFieldName("arguments");
    if (args === null) return null;
    after = `hmac.Equal${source.slice(args.startIndex, args.endIndex)}`;
  } else {
    // <left> == <right> → hmac.Equal([]byte(left), []byte(right)). Only `==` is fixable.
    const op = target.node.childForFieldName("operator")?.text;
    if (op !== "==") return null;
    const left = target.node.childForFieldName("left");
    const right = target.node.childForFieldName("right");
    if (left === null || right === null) return null;
    const leftSrc = toByteSlice(source.slice(left.startIndex, left.endIndex));
    const rightSrc = toByteSlice(source.slice(right.startIndex, right.endIndex));
    after = `hmac.Equal(${leftSrc}, ${rightSrc})`;
  }

  const node = target.node;
  const before = source.slice(node.startIndex, node.endIndex);
  const importsToAdd = hasCryptoHmacImport(parsedFile)
    ? undefined
    : ([{ module: "crypto/hmac" }] as const);
  return {
    ruleId: finding.rule_id,
    routineId: ROUTINE_ID,
    filePath: parsedFile.file_path,
    startByte: node.startIndex,
    endByte: node.endIndex,
    start: { line: node.startPosition.row + 1, col: node.startPosition.column + 1 },
    end: { line: node.endPosition.row + 1, col: node.endPosition.column + 1 },
    before,
    after,
    safety: "safe",
    ...(importsToAdd ? { importsToAdd } : {}),
  };
}

// Wrap an operand in []byte(...) for hmac.Equal. Unwrap a `string(X)` conversion first so we emit
// []byte(X) rather than the redundant []byte(string(X)). Identity conversion is valid when X is
// already []byte.
function toByteSlice(operand: string): string {
  const m = operand.match(/^string\((.+)\)$/s);
  const inner = m?.[1] ?? operand;
  return `[]byte(${inner})`;
}

function hasCryptoHmacImport(parsedFile: ParsedFile): boolean {
  return parsedFile.imports.some((e) => e.to_module === "crypto/hmac");
}

type FixTarget = { kind: "call" | "binary"; node: TsNode };

const GO_SIG_RE = /(sig|signature|hmac|mac|digest|expected|computed|provided)/i;

// Derive the handler's line span (max end-line of any node STARTING on the finding line — i.e. the
// enclosing func/method declaration), then collect every fixable target (bytes.Equal call or a
// signature-shaped == binary) starting within [findingLine, handlerEndLine]. Return the SOLE match;
// zero or many ⇒ null (a safe fixer never guesses which comparison is the signature check).
function findSoleFixTarget(root: TsNode, findingLine: number): FixTarget | null {
  let handlerEndLine = findingLine;
  const targets: FixTarget[] = [];
  const stack: TsNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    if (startLine === findingLine && endLine > handlerEndLine) handlerEndLine = endLine;
    if (node.type === "call_expression" && calleeQName(node) === "bytes.Equal") {
      targets.push({ kind: "call", node });
    } else if (node.type === "binary_expression") {
      const op = node.childForFieldName("operator")?.text;
      const left = node.childForFieldName("left")?.text ?? "";
      const right = node.childForFieldName("right")?.text ?? "";
      if (op === "==" && (GO_SIG_RE.test(left) || GO_SIG_RE.test(right))) {
        targets.push({ kind: "binary", node });
      }
    }
    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i);
      if (child !== null) stack.push(child);
    }
  }
  const inHandler = targets.filter((t) => {
    const line = t.node.startPosition.row + 1;
    return line >= findingLine && line <= handlerEndLine;
  });
  return inHandler.length === 1 ? (inHandler[0] ?? null) : null;
}

function calleeQName(call: TsNode): string | null {
  const fn = call.childForFieldName("function");
  if (fn === null || fn.type !== "selector_expression") return null;
  const operand = fn.childForFieldName("operand");
  const field = fn.childForFieldName("field");
  if (operand === null || field === null) return null;
  return `${operand.text}.${field.text}`;
}

function sliceLine(source: string, line: number): string {
  let currentLine = 1;
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    if (currentLine === line) {
      const nl = source.indexOf("\n", i);
      return source.slice(start, nl === -1 ? source.length : nl);
    }
    if (source.charCodeAt(i) === 0x0a) {
      currentLine++;
      start = i + 1;
    }
  }
  return "";
}
