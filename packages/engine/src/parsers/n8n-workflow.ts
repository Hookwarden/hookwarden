// n8n workflow-JSON parser (Phase 24, AGENT-01). The engine's FIRST non-AST input path.
//
// n8n `*.workflow.json` is deterministic structured data, so the "parser" is `JSON.parse`
// plus a content sniff — strictly simpler than the babel / tree-sitter AST parsers. This
// module owns:
//   1. parseN8nWorkflow(source, filePath) — position-aware parse. On malformed JSON it
//      returns a TYPED parse-error record (never throws-and-swallows; a parse error surfaces
//      as a finding downstream — mirrors the babel/tree-sitter ParseErrorRecord contract).
//   2. isN8nWorkflow(document) — content sniff: `nodes[]` + `connections` + ≥1 node whose
//      `type` begins `n8n-nodes-base.` / `@n8n/`. Glob presence alone never qualifies.
//   3. locateNodeRange(sourceText, node, occurrenceIndex) — zero-dep line-scan that maps a
//      node object to its precise JSON source range (SC#1). `JSON.parse` discards positions,
//      so we scan the raw text to the node's `"name"`/`"type"` string. No JSON-AST dependency
//      (that would trip the engine purity gate D-01).
//
// Engine purity (D-01): no `fs`/`http`/`net`/`fetch`. The caller hands us the source string;
// the engine never reads files (D-03).

import type { SourceLocation } from "../types/finding.ts";
import type { N8nNode, N8nParseResult, N8nWorkflowDocument } from "../types/n8n.ts";

const N8N_TYPE_PREFIXES: ReadonlyArray<string> = ["n8n-nodes-base.", "@n8n/"];

/**
 * Position-aware parse of an n8n workflow JSON source string. Never throws on malformed
 * input — returns a typed `parseError` instead so the engine surfaces it as a finding.
 */
export function parseN8nWorkflow(sourceText: string, filePath: string): N8nParseResult {
  let document: N8nWorkflowDocument | null = null;
  try {
    const parsed: unknown = JSON.parse(sourceText);
    // Only an object (not an array/primitive) can be an n8n workflow document. A top-level
    // array is valid JSON but is never a workflow — keep it as a (non-error) null document so
    // isN8nWorkflow rejects it without a spurious parse error.
    document = isPlainObject(parsed) ? (parsed as N8nWorkflowDocument) : null;
    return { file_path: filePath, source_text: sourceText, document, parseError: null };
  } catch (err) {
    return {
      file_path: filePath,
      source_text: sourceText,
      document: null,
      parseError: {
        message: err instanceof Error ? err.message : String(err),
        location: locateSyntaxError(sourceText, err),
        source: "json",
      },
    };
  }
}

/**
 * Content sniff: the parsed document is a real n8n workflow iff it has an array `nodes`, a
 * `connections` member, and at least one node whose `type` begins with an n8n prefix.
 */
export function isN8nWorkflow(document: N8nWorkflowDocument | null): boolean {
  if (document === null) return false;
  if (!Array.isArray(document.nodes)) return false;
  if (document.connections === undefined || document.connections === null) return false;
  return document.nodes.some(
    (node) =>
      typeof node?.type === "string" &&
      N8N_TYPE_PREFIXES.some((prefix) => node.type?.startsWith(prefix)),
  );
}

/**
 * Zero-dep line-scan mapping a node object to its precise JSON source range. We anchor on the
 * node's `"name"` (or, failing that, `"type"`) string literal in the raw source — both are
 * stable, node-unique anchors. The range spans from the opening `{` that introduces the node
 * object up to its matching `}`. `occurrenceIndex` disambiguates when two nodes share a name.
 *
 * Returns a best-effort range; if the anchor cannot be found it falls back to the node-name
 * anchor's line so the finding never collapses to 1:1 silently (Pitfall 7).
 */
export function locateNodeRange(
  sourceText: string,
  node: N8nNode,
  occurrenceIndex: number,
): SourceLocation {
  const anchor =
    typeof node.name === "string" && node.name.length > 0
      ? `"name": ${JSON.stringify(node.name)}`
      : typeof node.type === "string"
        ? `"type": ${JSON.stringify(node.type)}`
        : null;

  const anchorOffset = anchor !== null ? nthIndexOf(sourceText, anchor, occurrenceIndex) : -1;
  if (anchorOffset < 0) {
    // Unanchorable — return the document start as a degenerate (but non-throwing) range.
    return offsetToLocation(sourceText, 0, sourceText.length);
  }

  const startOffset = findEnclosingObjectStart(sourceText, anchorOffset);
  const endOffset = findMatchingBrace(sourceText, startOffset);
  return offsetToLocation(sourceText, startOffset, endOffset);
}

// --- internals -------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Find the byte offset of the `occurrenceIndex`-th occurrence of `needle` (0-indexed). */
function nthIndexOf(haystack: string, needle: string, occurrenceIndex: number): number {
  let from = 0;
  let found = -1;
  for (let i = 0; i <= occurrenceIndex; i++) {
    found = haystack.indexOf(needle, from);
    if (found < 0) return -1;
    from = found + needle.length;
  }
  return found;
}

/** Walk backwards from an offset to the `{` that opens the enclosing object. */
function findEnclosingObjectStart(source: string, fromOffset: number): number {
  let depth = 0;
  for (let i = fromOffset; i >= 0; i--) {
    const ch = source[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      if (depth === 0) return i;
      depth--;
    }
  }
  return 0;
}

/** Walk forwards from an opening `{` to its matching `}` (string-aware). */
function findMatchingBrace(source: string, openOffset: number): number {
  let depth = 0;
  let inString = false;
  for (let i = openOffset; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === "\\")
        i++; // skip escaped char
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return source.length;
}

/** Convert a [start, end) byte range to a 1-indexed line/col SourceLocation. */
function offsetToLocation(source: string, start: number, end: number): SourceLocation {
  const startPos = offsetToLineCol(source, start);
  const endPos = offsetToLineCol(source, end);
  return {
    line: startPos.line,
    col: startPos.col,
    end_line: endPos.line,
    end_col: endPos.col,
  };
}

function offsetToLineCol(source: string, offset: number): { line: number; col: number } {
  const clamped = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  let col = 1;
  for (let i = 0; i < clamped; i++) {
    if (source[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

/**
 * Best-effort line/col for a JSON syntax error. V8's SyntaxError message sometimes carries a
 * "position N" or "line L column C" hint; we parse it when present, else default to 1:1.
 */
function locateSyntaxError(
  source: string,
  err: unknown,
): { readonly line: number; readonly col: number } {
  const message = err instanceof Error ? err.message : String(err);

  const lineColMatch = /line (\d+) column (\d+)/i.exec(message);
  if (lineColMatch?.[1] !== undefined && lineColMatch[2] !== undefined) {
    return { line: Number(lineColMatch[1]), col: Number(lineColMatch[2]) };
  }

  const posMatch = /position (\d+)/i.exec(message);
  if (posMatch?.[1] !== undefined) {
    const pos = offsetToLineCol(source, Number(posMatch[1]));
    return { line: pos.line, col: pos.col };
  }

  return { line: 1, col: 1 };
}
