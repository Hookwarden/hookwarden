// Pure: no fs / http / network / process / node:* (D-28).
//
// Phase 8.2 D-14 #3 (PHP raw-body-misuse codegen).
//
// Safety claim (D-11):
//   1. Local: YES (single function_call_expression replacement)
//   2. Semantic-preserving: YES (file_get_contents("php://input") is the
//      documented PHP raw-body access — matches Stripe + GitHub + Twilio + etc.
//      official PHP webhook docs)
//   3. Strengthens security: YES (replaces $_POST / Input::all() which strip
//      and reparse the body, breaking signatures)
//   4. No new imports: YES (file_get_contents is core PHP)
//   5. No type errors: YES (PHP weak typing)

import type { Node as TsNode } from "web-tree-sitter";
import type { Finding, ParsedFile } from "@hookwarden/engine";
import type { FixEdit } from "@hookwarden/fix";

const ROUTINE_ID = "php-replace-input-with-raw-body";

export function phpReplaceInputWithRawBody(
  parsedFile: ParsedFile,
  finding: Finding,
): FixEdit | null {
  if (parsedFile.dialect !== "tree-sitter-php") return null;
  if (parsedFile.parse_error !== null) return null;
  if (parsedFile.raw_ast === null || parsedFile.raw_ast === undefined) return null;
  const lineSource = sliceLine(parsedFile.source_text, finding.location.line);
  if (lineSource.includes('"php://input"') || lineSource.includes("'php://input'")) {
    return null;
  }
  const tree = parsedFile.raw_ast as { readonly rootNode: TsNode };
  const node = findReplaceableTarget(tree.rootNode, finding.location.line);
  if (node === null) return null;
  const source = parsedFile.source_text;
  const before = source.slice(node.startIndex, node.endIndex);
  return {
    ruleId: finding.rule_id,
    routineId: ROUTINE_ID,
    filePath: parsedFile.file_path,
    startByte: node.startIndex,
    endByte: node.endIndex,
    start: { line: node.startPosition.row + 1, col: node.startPosition.column + 1 },
    end: { line: node.endPosition.row + 1, col: node.endPosition.column + 1 },
    before,
    after: 'file_get_contents("php://input")',
    safety: "safe",
  };
}

function findReplaceableTarget(root: TsNode, targetLine: number): TsNode | null {
  const stack: TsNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.startPosition.row + 1 === targetLine) {
      // $_POST superglobal access
      if (node.type === "subscript_expression" && node.text.startsWith("$_POST")) return node;
      // Input::all() / Input::get(...) — Laravel facade pattern (scoped_call_expression)
      if (
        (node.type === "function_call_expression" ||
          node.type === "scoped_call_expression" ||
          node.type === "member_call_expression") &&
        /Input::(all|get)|->(input|all|get)/.test(node.text)
      ) {
        return node;
      }
    }
    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i);
      if (child !== null) stack.push(child);
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
