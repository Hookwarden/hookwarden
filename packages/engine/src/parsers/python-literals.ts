// Walks a tree-sitter-python tree and emits LiteralSpan[] for the redactor (D-39).
// Pure: in-memory tree traversal only — engine purity gate (D-01) bans any I/O imports.

import type { Node, Tree } from "web-tree-sitter";
import type { LiteralSpan } from "../redaction/structural.js";

// tree-sitter-python literal node types we care about. (Confirmed against tree-sitter-python's
// `node-types.json`; if a grammar bump renames any of these, update this list.)
const STRING_NODES = ["string"] as const;
const NUMBER_NODES = ["integer", "float"] as const;

export function extractPythonLiterals(tree: Tree | null): ReadonlyArray<LiteralSpan> {
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
    // String literal. Detect f-string by looking for an `interpolation` named descendant.
    // (Some grammar versions use `string_interpolation`; treat both as template.)
    const isTemplate =
      node.descendantsOfType(["interpolation", "string_interpolation"]).length > 0;
    if (isTemplate) {
      out.push({
        kind: "template",
        start: node.startIndex,
        end: node.endIndex,
        value: "<TEMPLATE>",
      });
      continue;
    }
    // Plain string literal. The `text` field includes the quote characters and any prefix
    // (b, r, u). Strip prefix + quotes to get the inner value for length-aware redaction.
    const innerValue = stripPythonQuotes(node.text);
    out.push({
      kind: "string",
      start: node.startIndex,
      end: node.endIndex,
      value: innerValue,
    });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

function stripPythonQuotes(raw: string): string {
  // Strip any prefix character (b, r, u, B, R, U, plus combos like rb, fr).
  let i = 0;
  while (i < raw.length && /[bBrRuUfF]/.test(raw[i] ?? "")) i++;
  const quoted = raw.slice(i);
  // Triple-quoted ('''x''' or """x""") and single-quoted ('x' or "x").
  if (quoted.startsWith('"""') || quoted.startsWith("'''")) {
    return quoted.slice(3, quoted.length - 3);
  }
  if (quoted.startsWith('"') || quoted.startsWith("'")) {
    return quoted.slice(1, quoted.length - 1);
  }
  return quoted;
}

// Re-export Node type so callers don't need to depend on web-tree-sitter directly.
export type { Node as TreeSitterNode };
