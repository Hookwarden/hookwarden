// Phase 8.2 D-08: per-edit safety mask.
//
// Every rewriter consults the mask before applying any edit. If a candidate
// edit's [start_byte, end_byte) intersects a forbidden range, the rewriter
// rejects it. This is the load-bearing safety property that makes text-range
// substitution viable across all 3 languages.
//
// Mask coverage by dialect:
//   - babel (JS/TS):         TemplateLiteral, CommentBlock, CommentLine
//   - tree-sitter-python:    triple-quoted string, comment
//   - tree-sitter-php:       heredoc, nowdoc, encapsed_string, comment,
//                            shell_command_expression
//   - tree-sitter-go:        interpreted_string_literal, raw_string_literal,
//                            rune_literal, comment
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ParsedFile } from "@hookwarden/engine";
import type { Node as TsNode, Tree as TsTree } from "web-tree-sitter";

export interface ForbiddenRange {
  readonly start: number; // byte offset, inclusive
  readonly end: number; // byte offset, exclusive
  readonly kind:
    | "heredoc"
    | "nowdoc"
    | "template-literal"
    | "triple-quoted"
    | "comment"
    | "encapsed-string"
    | "shell-command"
    | "go-string"
    | "rune";
}

const PHP_FORBIDDEN_NODE_KINDS: ReadonlySet<string> = new Set([
  "heredoc",
  "nowdoc",
  "encapsed_string",
  "comment",
  "shell_command_expression",
]);

const PHP_NODE_KIND_TO_RANGE_KIND: Readonly<Record<string, ForbiddenRange["kind"]>> = {
  heredoc: "heredoc",
  nowdoc: "nowdoc",
  encapsed_string: "encapsed-string",
  comment: "comment",
  shell_command_expression: "shell-command",
};

const GO_FORBIDDEN_NODE_KINDS: ReadonlySet<string> = new Set([
  "comment",
  "interpreted_string_literal",
  "raw_string_literal",
  "rune_literal",
]);

const GO_NODE_KIND_TO_RANGE_KIND: Readonly<Record<string, ForbiddenRange["kind"]>> = {
  comment: "comment",
  interpreted_string_literal: "go-string",
  raw_string_literal: "go-string",
  rune_literal: "rune",
};

export function buildForbiddenRanges(parsedFile: ParsedFile): ReadonlyArray<ForbiddenRange> {
  const out: ForbiddenRange[] = [];
  switch (parsedFile.dialect) {
    case "babel":
      walkBabel(parsedFile.raw_ast, out);
      break;
    case "tree-sitter-python":
      walkPython(parsedFile.raw_ast as TsTree | null, out);
      break;
    case "tree-sitter-php":
      walkPhp(parsedFile.raw_ast as TsTree | null, out);
      break;
    case "tree-sitter-go":
      walkGo(parsedFile.raw_ast as TsTree | null, out);
      break;
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

export function intersects(
  edit: { readonly start: number; readonly end: number },
  mask: ReadonlyArray<ForbiddenRange>,
): boolean {
  // Half-open semantics: adjacency does not intersect.
  for (const r of mask) {
    if (edit.start < r.end && r.start < edit.end) return true;
  }
  return false;
}

// ----- babel walker -----

interface BabelNodeLike {
  readonly type: string;
  readonly start?: number;
  readonly end?: number;
  readonly leadingComments?: ReadonlyArray<BabelNodeLike>;
  readonly trailingComments?: ReadonlyArray<BabelNodeLike>;
  readonly innerComments?: ReadonlyArray<BabelNodeLike>;
  readonly comments?: ReadonlyArray<BabelNodeLike>;
  // children accessed dynamically below
}

const BABEL_KIND_FOR_TYPE: Readonly<Record<string, ForbiddenRange["kind"]>> = {
  TemplateLiteral: "template-literal",
  CommentBlock: "comment",
  CommentLine: "comment",
};

function walkBabel(root: unknown, out: ForbiddenRange[]): void {
  if (root === null || root === undefined) return;
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || node === undefined) continue;
    if (typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
      continue;
    }
    const n = node as BabelNodeLike & Record<string, unknown>;
    if (typeof n.type === "string") {
      const kind = BABEL_KIND_FOR_TYPE[n.type];
      if (kind !== undefined && typeof n.start === "number" && typeof n.end === "number") {
        out.push({ start: n.start, end: n.end, kind });
      }
      // Comments are attached as side properties on the parent node by @babel/parser
      // (attachComment is false in the engine, but `program.comments` is still
      // populated as a top-level array on the File node).
      pushCommentArray(n.leadingComments, out);
      pushCommentArray(n.trailingComments, out);
      pushCommentArray(n.innerComments, out);
      pushCommentArray(n.comments, out);
    }
    for (const key of Object.keys(n)) {
      // Skip the side-channel comment arrays (already handled above) and
      // non-AST scalar fields.
      if (
        key === "leadingComments" ||
        key === "trailingComments" ||
        key === "innerComments" ||
        key === "comments" ||
        key === "loc" ||
        key === "extra"
      ) {
        continue;
      }
      const child = n[key];
      if (child !== null && typeof child === "object") stack.push(child);
    }
  }
}

function pushCommentArray(
  comments: ReadonlyArray<BabelNodeLike> | undefined,
  out: ForbiddenRange[],
): void {
  if (!comments) return;
  for (const c of comments) {
    if (typeof c.start === "number" && typeof c.end === "number") {
      out.push({ start: c.start, end: c.end, kind: "comment" });
    }
  }
}

// ----- tree-sitter-python walker -----

function walkPython(tree: TsTree | null, out: ForbiddenRange[]): void {
  if (tree === null) return;
  walkTsCursor(tree.rootNode, (node) => {
    if (node.type === "comment") {
      out.push({ start: node.startIndex, end: node.endIndex, kind: "comment" });
      return;
    }
    if (node.type === "string") {
      // Triple-quoted strings have a `string_start` child whose text is `"""` or `'''`.
      const opener = pythonStringOpener(node);
      if (opener === '"""' || opener === "'''") {
        out.push({ start: node.startIndex, end: node.endIndex, kind: "triple-quoted" });
      }
    }
  });
}

function pythonStringOpener(node: TsNode): string | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child === null) continue;
    if (child.type === "string_start") return child.text;
  }
  return null;
}

// ----- tree-sitter-php walker -----

function walkPhp(tree: TsTree | null, out: ForbiddenRange[]): void {
  if (tree === null) return;
  walkTsCursor(tree.rootNode, (node) => {
    if (!PHP_FORBIDDEN_NODE_KINDS.has(node.type)) return;
    const kind = PHP_NODE_KIND_TO_RANGE_KIND[node.type];
    if (kind === undefined) return;
    out.push({ start: node.startIndex, end: node.endIndex, kind });
  });
}

// ----- tree-sitter-go walker -----

function walkGo(tree: TsTree | null, out: ForbiddenRange[]): void {
  if (tree === null) return;
  walkTsCursor(tree.rootNode, (node) => {
    if (!GO_FORBIDDEN_NODE_KINDS.has(node.type)) return;
    const kind = GO_NODE_KIND_TO_RANGE_KIND[node.type];
    if (kind === undefined) return;
    out.push({ start: node.startIndex, end: node.endIndex, kind });
  });
}

// Generic tree-sitter walker — DFS via the Node API.
function walkTsCursor(root: TsNode, visit: (node: TsNode) => void): void {
  const stack: TsNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    visit(node);
    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i);
      if (child !== null) stack.push(child);
    }
  }
}
