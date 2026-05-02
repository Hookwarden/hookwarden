// Walks a Babel File and extracts every literal span the redactor needs.
// Pure traversal: depth-first over the AST. We avoid importing @babel/traverse to keep deps minimal —
// manual walk is enough for literals.

import type { File } from "@babel/types";
import type { LiteralSpan } from "../redaction/structural.js";

// Babel nodes are a discriminated union. We treat any node-like object as a `MaybeSpanned`
// here — defensive because `@babel/types`'s `Node` union prevents `extends Node` patterns.
interface MaybeSpanned {
  readonly type?: string;
  readonly start?: number | null;
  readonly end?: number | null;
}

function pushSpan(
  out: LiteralSpan[],
  kind: LiteralSpan["kind"],
  node: MaybeSpanned,
  value: string,
): void {
  if (typeof node.start !== "number" || typeof node.end !== "number") return;
  out.push({ kind, start: node.start, end: node.end, value });
}

function visit(node: MaybeSpanned | null | undefined, out: LiteralSpan[]): void {
  if (!node || typeof node.type !== "string") return;
  switch (node.type) {
    case "StringLiteral":
      pushSpan(out, "string", node, (node as unknown as { value: string }).value);
      return;
    case "NumericLiteral":
    case "BigIntLiteral":
      pushSpan(out, "number", node, String((node as unknown as { value: unknown }).value));
      return;
    case "TemplateLiteral":
      // Capture the whole template literal as one span; substitution values must not survive.
      pushSpan(out, "template", node, "<TEMPLATE>");
      return;
    case "RegExpLiteral":
      pushSpan(out, "regex", node, (node as unknown as { pattern: string }).pattern);
      return;
    default:
      break;
  }
  // Recurse into every child key.
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end" || key === "range" || key === "type") {
      continue;
    }
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && "type" in item) {
          visit(item as MaybeSpanned, out);
        }
      }
    } else if (value && typeof value === "object" && "type" in value) {
      visit(value as MaybeSpanned, out);
    }
  }
}

export function extractBabelLiterals(ast: File | null): ReadonlyArray<LiteralSpan> {
  if (ast === null) return [];
  const out: LiteralSpan[] = [];
  visit(ast as unknown as MaybeSpanned, out);
  // Stable order: ascending by start.
  out.sort((a, b) => a.start - b.start);
  return out;
}
