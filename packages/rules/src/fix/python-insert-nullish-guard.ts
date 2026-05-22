// Pure: no fs / http / network / process / node:* (D-28).
//
// Phase 8.2 D-14 #2 (Python missing-nullish-guard codegen).
//
// Safety claim (D-11):
//   1. Local: YES (single statement at the line above the HMAC compare)
//   2. Semantic-preserving: YES (early raise on missing signature is canonical)
//   3. Strengthens security: YES
//   4. No new imports: YES (ValueError is a Python builtin)
//   5. No type errors: YES

import type { Node as TsNode } from "web-tree-sitter";
import type { Finding, ParsedFile } from "@hookwarden/engine";
import type { FixEdit } from "@hookwarden/fix";

const ROUTINE_ID = "python-insert-nullish-guard";

export function pythonInsertNullishGuard(
  parsedFile: ParsedFile,
  finding: Finding,
): FixEdit | null {
  if (parsedFile.dialect !== "tree-sitter-python") return null;
  if (parsedFile.parse_error !== null) return null;
  if (parsedFile.raw_ast === null || parsedFile.raw_ast === undefined) return null;
  const source = parsedFile.source_text;
  const targetLine = finding.location.line;
  const lineSource = sliceLine(source, targetLine);
  if (lineSource.match(/\bif\b.*\bis\s+None\b/) !== null) return null;
  const insertionByte = lineStartByte(source, targetLine);
  if (insertionByte === null) return null;
  const tree = parsedFile.raw_ast as { readonly rootNode: TsNode };
  const variable = inferSignatureVariable(tree.rootNode, targetLine) ?? "sig";
  const indent = lineSource.match(/^[ \t]*/)?.[0] ?? "";
  const after = `${indent}if ${variable} is None:\n${indent}    raise ValueError("Webhook signature missing")\n`;
  return {
    ruleId: finding.rule_id,
    routineId: ROUTINE_ID,
    filePath: parsedFile.file_path,
    startByte: insertionByte,
    endByte: insertionByte,
    start: { line: targetLine, col: 1 },
    end: { line: targetLine, col: 1 },
    before: "",
    after,
    safety: "safe",
  };
}

function inferSignatureVariable(root: TsNode, targetLine: number): string | null {
  const stack: TsNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === "call" && node.startPosition.row + 1 === targetLine) {
      const args = node.childForFieldName("arguments");
      if (args !== null && args.namedChildCount > 1) {
        // hmac.compare_digest(expected, sig) — second arg is the user-supplied signature.
        const sigArg = args.namedChild(1);
        if (sigArg !== null && sigArg.type === "identifier") return sigArg.text;
      }
    }
    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i);
      if (child !== null) stack.push(child);
    }
  }
  return null;
}

function lineStartByte(source: string, line: number): number | null {
  if (line <= 1) return 0;
  let currentLine = 1;
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 0x0a) {
      currentLine++;
      if (currentLine === line) return i + 1;
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
