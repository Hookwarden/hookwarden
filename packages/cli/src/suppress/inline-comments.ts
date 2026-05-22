// D-61 inline disable comments: 3 forms × JS/TS+Python+PHP × multi-rule comma-separated. CLI-side (engine purity).
// Rule-id REQUIRED — no silent global suppression. Comment extraction consumes ParsedFile.raw_ast and
// switches on dialect ("babel" | "tree-sitter-python" | "tree-sitter-php"); never re-initializes a parser.

import type { ParsedFile } from "@hookwarden/engine";

const DISABLE_NEXT_RE = /hookwarden-disable-next-line\s+([\w/,\s.-]+)/;
const DISABLE_LINE_RE = /hookwarden-disable-line\s+([\w/,\s.-]+)/;
const DISABLE_BLOCK_RE = /hookwarden-disable\s+([\w/,\s.-]+)/;
const ENABLE_BLOCK_RE = /hookwarden-enable\b/;

export interface InlineSuppressionEntry {
  readonly file_path: string;
  readonly line: number;
  readonly rule_ids: ReadonlyArray<string>;
  readonly form: "disable-next-line" | "disable-line" | "block";
  readonly comment_line: number;
}

export interface InlineSuppressions {
  readonly perLine: ReadonlyMap<string, ReadonlyMap<number, ReadonlySet<string>>>;
  readonly entries: ReadonlyArray<InlineSuppressionEntry>;
}

interface CommentLike {
  readonly value: string; // comment text without delimiters
  readonly line: number; // 1-based
}

function parseRuleIds(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.includes("/"));
}

interface BabelComment {
  readonly value: string;
  readonly loc?: { readonly start?: { readonly line: number } };
}

interface BabelFileNode {
  readonly comments?: ReadonlyArray<BabelComment>;
  readonly program?: { readonly comments?: ReadonlyArray<BabelComment> };
}

function extractCommentsFromBabel(raw: unknown): CommentLike[] {
  const ast = raw as BabelFileNode | null | undefined;
  const comments = ast?.comments ?? ast?.program?.comments;
  if (!comments) return [];
  return comments
    .map((c) => ({ value: c.value, line: c.loc?.start?.line ?? 0 }))
    .filter((c) => c.line > 0);
}

interface TreeSitterNodeShape {
  readonly type: string;
  readonly text?: string;
  readonly startPosition: { readonly row: number };
  readonly childCount: number;
  child(index: number): TreeSitterNodeShape | null;
}

interface TreeSitterTreeShape {
  readonly rootNode: TreeSitterNodeShape;
}

// tree-sitter (web-tree-sitter WASM) API surface — shared across Python + PHP grammars:
//   tree.rootNode               — root node
//   node.type === "comment"     — comment selector (both tree-sitter-python AND tree-sitter-php
//                                  use the same "comment" node type for // and # prefixes)
//   node.text                   — raw source slice including the comment prefix
//   node.startPosition.row      — 0-based row (we add 1 for 1-based line)
//   node.childCount + node.child(i) — child iteration
// Prefix-strip regex covers Python's `#` AND PHP's `//` and `#` (both are valid PHP single-line
// comment styles; tree-sitter-php parses both as `comment` nodes). Python source never contains
// `//`, so the union remains backwards-compatible.
function extractCommentsFromTreeSitter(raw: unknown): CommentLike[] {
  const tree = raw as TreeSitterTreeShape | null | undefined;
  if (!tree?.rootNode) return [];
  const out: CommentLike[] = [];
  const visit = (node: TreeSitterNodeShape | null): void => {
    if (node === null) return;
    if (node.type === "comment") {
      const text = (node.text ?? "").replace(/^(\/\/|#)\s?/, "");
      out.push({ value: text, line: node.startPosition.row + 1 });
    }
    for (let i = 0; i < node.childCount; i += 1) {
      visit(node.child(i));
    }
  };
  visit(tree.rootNode);
  return out;
}

function extractComments(file: ParsedFile): CommentLike[] {
  if (file.dialect === "tree-sitter-python" || file.dialect === "tree-sitter-php") {
    return extractCommentsFromTreeSitter(file.raw_ast);
  }
  return extractCommentsFromBabel(file.raw_ast);
}

export function extractInlineSuppressions(files: ReadonlyArray<ParsedFile>): InlineSuppressions {
  const perLine = new Map<string, Map<number, Set<string>>>();
  const entries: InlineSuppressionEntry[] = [];

  const addPerLine = (filePath: string, line: number, ruleIds: ReadonlyArray<string>): void => {
    let fileMap = perLine.get(filePath);
    if (!fileMap) {
      fileMap = new Map();
      perLine.set(filePath, fileMap);
    }
    let lineSet = fileMap.get(line);
    if (!lineSet) {
      lineSet = new Set();
      fileMap.set(line, lineSet);
    }
    for (const id of ruleIds) lineSet.add(id);
  };

  for (const file of files) {
    const comments = extractComments(file);
    let openBlock: { rule_ids: string[]; start_line: number } | null = null;
    for (const c of comments) {
      // Order matters: check next-line / line BEFORE generic disable-block.
      let m = DISABLE_NEXT_RE.exec(c.value);
      if (m && m[1] !== undefined) {
        const ids = parseRuleIds(m[1]);
        if (ids.length === 0) continue;
        const target = c.line + 1;
        addPerLine(file.file_path, target, ids);
        entries.push({
          file_path: file.file_path,
          line: target,
          rule_ids: ids,
          form: "disable-next-line",
          comment_line: c.line,
        });
        continue;
      }
      m = DISABLE_LINE_RE.exec(c.value);
      if (m && m[1] !== undefined) {
        const ids = parseRuleIds(m[1]);
        if (ids.length === 0) continue;
        addPerLine(file.file_path, c.line, ids);
        entries.push({
          file_path: file.file_path,
          line: c.line,
          rule_ids: ids,
          form: "disable-line",
          comment_line: c.line,
        });
        continue;
      }
      if (ENABLE_BLOCK_RE.test(c.value)) {
        if (openBlock !== null) {
          for (let ln = openBlock.start_line; ln <= c.line; ln += 1) {
            addPerLine(file.file_path, ln, openBlock.rule_ids);
          }
          entries.push({
            file_path: file.file_path,
            line: openBlock.start_line,
            rule_ids: openBlock.rule_ids,
            form: "block",
            comment_line: openBlock.start_line,
          });
          openBlock = null;
        }
        continue;
      }
      m = DISABLE_BLOCK_RE.exec(c.value);
      if (m && m[1] !== undefined && openBlock === null) {
        const ids = parseRuleIds(m[1]);
        if (ids.length === 0) continue;
        openBlock = { rule_ids: ids, start_line: c.line };
      }
    }
    // Block left open at EOF: extend to the last line of the file.
    if (openBlock !== null) {
      const lastLine = file.source_text.split(/\r?\n/).length;
      for (let ln = openBlock.start_line; ln <= lastLine; ln += 1) {
        addPerLine(file.file_path, ln, openBlock.rule_ids);
      }
      entries.push({
        file_path: file.file_path,
        line: openBlock.start_line,
        rule_ids: openBlock.rule_ids,
        form: "block",
        comment_line: openBlock.start_line,
      });
    }
  }

  return { perLine, entries };
}
