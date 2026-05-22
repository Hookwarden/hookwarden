// Pure: no fs / http / network / process / node:* (D-28).
//
// Phase 8.2 D-14 #1 (Python timing-unsafe-comparison codegen).
//
// Safety claim (D-11):
//   1. Local: YES (single comparison)
//   2. Semantic-preserving: YES (compare_digest returns bool like ==)
//   3. Strengthens security: YES (constant-time)
//   4. No new imports needed: NO — emits importsToAdd=[{module:"hmac"}] when absent
//   5. No type errors: YES (Python has no static type check by default)
//
// v0.5 conservative scope: only `==` operator. `!=` would require `not hmac.compare_digest(...)`
// which is a 2-byte INSERT in addition to the replacement — defer to v0.6+ per [[feedback_recommend_correct_not_cheap]].

import type { Finding, ParsedFile } from "@hookwarden/engine";
import type { FixEdit } from "@hookwarden/fix";
import type { Node as TsNode } from "web-tree-sitter";

const ROUTINE_ID = "python-replace-binary-equality";

export function pythonReplaceBinaryEquality(
  parsedFile: ParsedFile,
  finding: Finding,
): FixEdit | null {
  if (parsedFile.dialect !== "tree-sitter-python") return null;
  if (parsedFile.parse_error !== null) return null;
  if (parsedFile.raw_ast === null || parsedFile.raw_ast === undefined) return null;
  const lineSource = sliceLine(parsedFile.source_text, finding.location.line);
  if (lineSource.includes("compare_digest")) return null;
  const tree = parsedFile.raw_ast as { readonly rootNode: TsNode };
  const node = findComparisonAtLine(tree.rootNode, finding.location.line);
  if (node === null) return null;
  // Comparison node has children [left, operator, right]; operator must be `==`.
  const operatorChild = findOperatorChild(node);
  if (operatorChild === null || operatorChild.text !== "==") return null;
  const leftChild = node.child(0);
  const rightChild = node.child(node.childCount - 1);
  if (leftChild === null || rightChild === null) return null;
  const source = parsedFile.source_text;
  const before = source.slice(node.startIndex, node.endIndex);
  const leftSrc = source.slice(leftChild.startIndex, leftChild.endIndex);
  const rightSrc = source.slice(rightChild.startIndex, rightChild.endIndex);
  const after = `hmac.compare_digest(${leftSrc}, ${rightSrc})`;
  const importsToAdd = hasHmacImport(parsedFile) ? undefined : ([{ module: "hmac" }] as const);
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

function hasHmacImport(parsedFile: ParsedFile): boolean {
  for (const edge of parsedFile.imports) {
    if (edge.to_module === "hmac") return true;
  }
  return false;
}

function findComparisonAtLine(root: TsNode, targetLine: number): TsNode | null {
  const stack: TsNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === "comparison_operator" && node.startPosition.row + 1 === targetLine) {
      return node;
    }
    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i);
      if (child !== null) stack.push(child);
    }
  }
  return null;
}

function findOperatorChild(node: TsNode): TsNode | null {
  // tree-sitter-python comparison_operator has the operator as a named or anonymous middle child.
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child === null) continue;
    if (child.type === "==" || child.type === "!=" || child.type === "is" || child.type === "in") {
      return child;
    }
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
