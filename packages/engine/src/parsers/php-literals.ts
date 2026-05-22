// Walks a tree-sitter-php tree and emits LiteralSpan[] for the redactor (D-39).
// Pure: in-memory tree traversal only — engine purity gate (D-01) bans any I/O imports.
//
// PHP literal taxonomy (tree-sitter-php@0.24.2 node-types.json):
//   string         — single-quoted 'x' (NEVER interpolates)
//   encapsed_string — double-quoted "x" (interpolates if a variable_name child exists)
//   heredoc_body   — <<<EOT...EOT body (interpolates if a variable_name child exists)
//   nowdoc_body    — <<<'EOT'...EOT body (NEVER interpolates; single-quoted opener)
//   integer, float — numeric literals

import type { Node, Tree } from "web-tree-sitter";
import type { LiteralSpan } from "../redaction/structural.js";

const STRING_NODES = ["string", "encapsed_string", "heredoc_body", "nowdoc_body"] as const;
const NUMBER_NODES = ["integer", "float"] as const;
// Marker children that distinguish a template-style literal from a plain string.
const INTERPOLATION_MARKERS = [
  "variable_name",
  "dynamic_variable_name",
  "subscript_expression",
  "member_access_expression",
  "expression",
] as const;

export function extractPhpLiterals(tree: Tree | null): ReadonlyArray<LiteralSpan> {
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
    // String-shaped literal. Detect interpolation based on node type + descendants.
    let isTemplate = false;
    if (node.type === "encapsed_string" || node.type === "heredoc_body") {
      isTemplate = node.descendantsOfType([...INTERPOLATION_MARKERS]).length > 0;
    }
    if (isTemplate) {
      out.push({
        kind: "template",
        start: node.startIndex,
        end: node.endIndex,
        value: "<TEMPLATE>",
      });
      continue;
    }
    // Plain string literal. Strip delimiters to get the inner value for length-aware redaction.
    out.push({
      kind: "string",
      start: node.startIndex,
      end: node.endIndex,
      value: stripPhpDelimiters(node.text, node.type),
    });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

function stripPhpDelimiters(raw: string, nodeType: string): string {
  // heredoc_body / nowdoc_body content already excludes the <<<EOT opener and closer per the
  // grammar's field-vs-child split — the node.text is just the body lines.
  if (nodeType === "heredoc_body" || nodeType === "nowdoc_body") {
    // Trim a single trailing newline if present (heredoc body always ends with \n before EOT).
    return raw.endsWith("\n") ? raw.slice(0, -1) : raw;
  }
  // string / encapsed_string: node.text includes the wrapping quote characters.
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    return raw.slice(1, raw.length - 1);
  }
  return raw;
}

// Re-export Node type so callers don't need to depend on web-tree-sitter directly.
export type { Node as TreeSitterNode };
