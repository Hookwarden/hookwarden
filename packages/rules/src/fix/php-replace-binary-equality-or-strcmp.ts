// Pure: no fs / http / network / process / node:* (D-28).
//
// Phase 8.2 D-14 #1 (PHP timing-unsafe-comparison codegen).
//
// Safety claim (D-11):
//   1. Local: YES (single binary_expression range)
//   2. Semantic-preserving: YES (hash_equals returns bool; strcmp(...) === 0 returns bool)
//   3. Strengthens security: YES (constant-time)
//   4. No new imports: YES (hash_equals is core PHP — no importsToAdd)
//   5. No type errors: YES (PHP weak typing; hash_equals accepts string|null)
//
// Handles 2 shapes:
//   $expected === $sig                  → hash_equals($expected, $sig)
//   strcmp($expected, $sig) === 0       → hash_equals($expected, $sig)

import type { Finding, ParsedFile } from "@hookwarden/engine";
import type { FixEdit } from "@hookwarden/fix";
import type { Node as TsNode } from "web-tree-sitter";

const ROUTINE_ID = "php-replace-binary-equality-or-strcmp";
const VALID_OPERATORS: ReadonlySet<string> = new Set(["==", "===", "!=", "!=="]);
// Only `==`/`===` are auto-fixable in v0.5; `!=`/`!==` would need a `!hash_equals(...)`
// wrapper which is a 1-byte insert in addition to replacement — defer to v0.6+.
const FIXABLE_OPERATORS: ReadonlySet<string> = new Set(["==", "==="]);

export function phpReplaceBinaryEqualityOrStrcmp(
  parsedFile: ParsedFile,
  finding: Finding,
): FixEdit | null {
  if (parsedFile.dialect !== "tree-sitter-php") return null;
  if (parsedFile.parse_error !== null) return null;
  if (parsedFile.raw_ast === null || parsedFile.raw_ast === undefined) return null;
  const lineSource = sliceLine(parsedFile.source_text, finding.location.line);
  if (lineSource.includes("hash_equals")) return null;
  const tree = parsedFile.raw_ast as { readonly rootNode: TsNode };
  const node = findBinaryAtLine(tree.rootNode, finding.location.line);
  if (node === null) return null;
  const operator = findOperatorText(node);
  if (operator === null || !FIXABLE_OPERATORS.has(operator)) return null;
  const leftChild = node.childForFieldName("left");
  const rightChild = node.childForFieldName("right");
  if (leftChild === null || rightChild === null) return null;
  const source = parsedFile.source_text;
  // Detect the strcmp() === 0 shape: left side is a function_call_expression to strcmp,
  // right side is integer 0 (or vice versa).
  const strcmpArgs = extractStrcmpArgs(leftChild, rightChild, source);
  const before = source.slice(node.startIndex, node.endIndex);
  let after: string;
  if (strcmpArgs !== null) {
    after = `hash_equals(${strcmpArgs.a}, ${strcmpArgs.b})`;
  } else {
    const leftSrc = source.slice(leftChild.startIndex, leftChild.endIndex);
    const rightSrc = source.slice(rightChild.startIndex, rightChild.endIndex);
    after = `hash_equals(${leftSrc}, ${rightSrc})`;
  }
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
  };
}

function extractStrcmpArgs(
  leftChild: TsNode,
  rightChild: TsNode,
  _source: string,
): { a: string; b: string } | null {
  // strcmp(a, b) === 0  vs  0 === strcmp(a, b)
  const [callSide, zeroSide] = isIntegerZero(rightChild)
    ? [leftChild, rightChild]
    : isIntegerZero(leftChild)
      ? [rightChild, leftChild]
      : [null, null];
  if (callSide === null || zeroSide === null) return null;
  if (callSide.type !== "function_call_expression") return null;
  const fnNode = callSide.childForFieldName("function");
  if (fnNode === null || fnNode.text !== "strcmp") return null;
  const argsNode = callSide.childForFieldName("arguments");
  if (argsNode === null) return null;
  // arguments node has children like ( arg0 , arg1 ) — iterate named children.
  const namedArgs: TsNode[] = [];
  for (let i = 0; i < argsNode.namedChildCount; i++) {
    const c = argsNode.namedChild(i);
    if (c !== null) namedArgs.push(c);
  }
  if (namedArgs.length !== 2) return null;
  return {
    a: _source.slice(namedArgs[0]?.startIndex, namedArgs[0]?.endIndex),
    b: _source.slice(namedArgs[1]?.startIndex, namedArgs[1]?.endIndex),
  };
}

function isIntegerZero(node: TsNode): boolean {
  return node.type === "integer" && node.text === "0";
}

function findBinaryAtLine(root: TsNode, targetLine: number): TsNode | null {
  const stack: TsNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === "binary_expression" && node.startPosition.row + 1 === targetLine) {
      return node;
    }
    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i);
      if (child !== null) stack.push(child);
    }
  }
  return null;
}

function findOperatorText(node: TsNode): string | null {
  const operatorChild = node.childForFieldName("operator");
  if (operatorChild !== null) return operatorChild.text;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child === null) continue;
    if (VALID_OPERATORS.has(child.type)) return child.type;
  }
  return null;
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
