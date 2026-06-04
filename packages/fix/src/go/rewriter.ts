// Phase 27 (FIX-GO-01): Go rewriter primitive. Mirrors php/rewriter.ts.
//
// Go-specific safety: the forbidden-ranges mask blocks edits inside comments,
// interpreted_string_literal, raw_string_literal, and rune_literal. See
// GO_FORBIDDEN_NODE_KINDS in forbidden-ranges.ts — that constant is the single
// source of truth. The bounds / forbidden-range / multi-line checks are
// language-agnostic; only the dialect guard + error strings differ from PHP.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ParsedFile } from "@hookwarden/engine";
import { type ForbiddenRange, intersects } from "../forbidden-ranges.js";
import type { FixEdit } from "../index.js";
import type { RejectionReason } from "../javascript/rewriter.js";
import { applyEdits } from "../text-range-applier.js";

export interface RewriteGoInput {
  readonly parsedFile: ParsedFile;
  readonly edits: ReadonlyArray<FixEdit>;
  readonly forbiddenRanges: ReadonlyArray<ForbiddenRange>;
}

export interface RewriteGoResult {
  readonly newSource: string;
  readonly applied: ReadonlyArray<FixEdit>;
  readonly rejected: ReadonlyArray<{ readonly edit: FixEdit; readonly reason: RejectionReason }>;
}

export function rewriteGo(input: RewriteGoInput): RewriteGoResult {
  const { parsedFile, edits, forbiddenRanges } = input;
  if (parsedFile.dialect !== "tree-sitter-go") {
    throw new TypeError(
      `rewriteGo: expected dialect "tree-sitter-go", got "${parsedFile.dialect}"`,
    );
  }
  if (parsedFile.parse_error !== null) {
    throw new Error(
      `rewriteGo: refusing to rewrite ${parsedFile.file_path} — parse error: ${parsedFile.parse_error.message}`,
    );
  }
  const source = parsedFile.source_text;
  const applied: FixEdit[] = [];
  const rejected: Array<{ edit: FixEdit; reason: RejectionReason }> = [];
  for (const edit of edits) {
    if (edit.endByte > source.length || edit.startByte < 0) {
      rejected.push({ edit, reason: "out-of-bounds" });
      continue;
    }
    if (intersects({ start: edit.startByte, end: edit.endByte }, forbiddenRanges)) {
      rejected.push({ edit, reason: "forbidden-range" });
      continue;
    }
    if (spansMultipleLines(source, edit.startByte, edit.endByte)) {
      rejected.push({ edit, reason: "multi-line" });
      continue;
    }
    applied.push(edit);
  }
  const newSource = applyEdits(
    source,
    applied.map((e) => ({
      start: e.startByte,
      end: e.endByte,
      replacement: e.after,
      rule_id: e.ruleId,
    })),
  );
  return { newSource, applied, rejected };
}

function spansMultipleLines(source: string, startByte: number, endByte: number): boolean {
  for (let i = startByte; i < endByte; i++) {
    if (source.charCodeAt(i) === 0x0a) return true;
  }
  return false;
}
