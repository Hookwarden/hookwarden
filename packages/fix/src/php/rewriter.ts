// Phase 8.2 D-06 + D-07 + D-08: PHP rewriter primitive.
//
// PHP-specific safety: the forbidden-ranges mask blocks edits inside heredocs,
// nowdocs, encapsed_strings (double-quoted with interpolation), comments,
// and shell_command_expression. See PHP_FORBIDDEN_NODE_KINDS in
// forbidden-ranges.ts — that constant is the single source of truth.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ParsedFile } from "@hookwarden/engine";
import type { FixEdit } from "../index.js";
import { type ForbiddenRange, intersects } from "../forbidden-ranges.js";
import { applyEdits } from "../text-range-applier.js";
import type { RejectionReason } from "../javascript/rewriter.js";

export interface RewritePhpInput {
  readonly parsedFile: ParsedFile;
  readonly edits: ReadonlyArray<FixEdit>;
  readonly forbiddenRanges: ReadonlyArray<ForbiddenRange>;
}

export interface RewritePhpResult {
  readonly newSource: string;
  readonly applied: ReadonlyArray<FixEdit>;
  readonly rejected: ReadonlyArray<{ readonly edit: FixEdit; readonly reason: RejectionReason }>;
}

export function rewritePhp(input: RewritePhpInput): RewritePhpResult {
  const { parsedFile, edits, forbiddenRanges } = input;
  if (parsedFile.dialect !== "tree-sitter-php") {
    throw new TypeError(
      `rewritePhp: expected dialect "tree-sitter-php", got "${parsedFile.dialect}"`,
    );
  }
  if (parsedFile.parse_error !== null) {
    throw new Error(
      `rewritePhp: refusing to rewrite ${parsedFile.file_path} — parse error: ${parsedFile.parse_error.message}`,
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
