// Walks a Babel File and extracts every literal span the redactor needs.
// Pure traversal: depth-first via the shared walkUntypedAst helper. No @babel/traverse dep.

import type { File } from "@babel/types";
import type { LiteralSpan } from "../redaction/structural.js";
import { walkUntypedAst, type MaybeAstNode } from "./walk.js";

function pushSpan(
  out: LiteralSpan[],
  kind: LiteralSpan["kind"],
  node: MaybeAstNode,
  value: string,
): void {
  if (typeof node.start !== "number" || typeof node.end !== "number") return;
  out.push({ kind, start: node.start, end: node.end, value });
}

export function extractBabelLiterals(ast: File | null): ReadonlyArray<LiteralSpan> {
  if (ast === null) return [];
  const out: LiteralSpan[] = [];
  walkUntypedAst(ast as unknown as MaybeAstNode, (node) => {
    switch (node.type) {
      case "StringLiteral":
        pushSpan(out, "string", node, (node as unknown as { value: string }).value);
        return;
      case "NumericLiteral":
      case "BigIntLiteral":
        pushSpan(out, "number", node, String((node as unknown as { value: unknown }).value));
        return;
      case "TemplateLiteral":
        // Whole template captured as one span so substitution values cannot survive redaction.
        pushSpan(out, "template", node, "<TEMPLATE>");
        return;
      case "RegExpLiteral":
        pushSpan(out, "regex", node, (node as unknown as { pattern: string }).pattern);
        return;
      default:
        return;
    }
  });
  // Stable order: ascending by start.
  out.sort((a, b) => a.start - b.start);
  return out;
}
