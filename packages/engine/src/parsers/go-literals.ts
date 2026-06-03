// Walks a tree-sitter-go tree and emits LiteralSpan[] for the redactor (D-39).
// Pure: in-memory tree traversal only — engine purity gate (D-01) bans any I/O imports.
//
// Go literal taxonomy (tree-sitter-go@0.25.0 node-types.json):
//   interpreted_string_literal — "x" (NO interpolation — Go has no string interpolation)
//   raw_string_literal         — `x` backtick form (NO interpolation)
//   rune_literal               — 'x' single character
//   int_literal, float_literal, imaginary_literal — numeric literals
// Because Go has no interpolation, every string-shaped literal is kind:"string" —
// the "template" kind is never emitted (contrast php-literals encapsed_string).

import type { Node, Tree } from "web-tree-sitter";
import type { LiteralSpan } from "../redaction/structural.js";

const STRING_NODES = ["interpreted_string_literal", "raw_string_literal", "rune_literal"] as const;
const NUMBER_NODES = ["int_literal", "float_literal", "imaginary_literal"] as const;

export function extractGoLiterals(tree: Tree | null): ReadonlyArray<LiteralSpan> {
  if (tree === null) return [];
  const out: LiteralSpan[] = [];
  const root = tree.rootNode;
  for (const node of root.descendantsOfType([...STRING_NODES, ...NUMBER_NODES])) {
    if ((NUMBER_NODES as readonly string[]).includes(node.type)) {
      out.push({
        kind: "number",
        start: node.startIndex,
        end: node.endIndex,
        value: node.text,
      });
      continue;
    }
    // String-shaped literal — Go never interpolates, so always kind:"string".
    out.push({
      kind: "string",
      start: node.startIndex,
      end: node.endIndex,
      value: stripGoDelimiters(node.text),
    });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

function stripGoDelimiters(raw: string): string {
  // interpreted_string_literal "..." / rune_literal '...' / raw_string_literal `...`:
  // node.text includes the wrapping delimiter on both ends.
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if (
      (first === '"' && last === '"') ||
      (first === "`" && last === "`") ||
      (first === "'" && last === "'")
    ) {
      return raw.slice(1, raw.length - 1);
    }
  }
  return raw;
}

// Re-export Node type so callers don't need to depend on web-tree-sitter directly.
export type { Node as TreeSitterNode };
