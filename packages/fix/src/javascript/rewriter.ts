// Phase 8.2 D-06 + D-07 + D-08: JS/TS rewriter primitive.
//
// Input: parsedFile (babel dialect, parse_error === null) + edit candidates +
//        forbidden-ranges mask.
// Output: newSource (text-range-substituted) + applied[] + rejected[].
//
// Three rejection reasons:
//   - "forbidden-range" — edit intersects a string / comment / template literal
//   - "multi-line"      — edit spans multiple source lines (D-07 single-line constraint)
//   - "out-of-bounds"   — edit's end_byte exceeds source_text.length
//
// Text-range only — no @babel/generator round-trip in v0.5 (D-06).
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ParsedFile } from "@hookwarden/engine";
import { type ForbiddenRange, intersects } from "../forbidden-ranges.js";
import type { FixEdit } from "../index.js";
import { applyEdits } from "../text-range-applier.js";

export interface RewriteJsInput {
  readonly parsedFile: ParsedFile;
  readonly edits: ReadonlyArray<FixEdit>;
  readonly forbiddenRanges: ReadonlyArray<ForbiddenRange>;
}

export type RejectionReason = "forbidden-range" | "multi-line" | "out-of-bounds";

export interface RewriteJsResult {
  readonly newSource: string;
  readonly applied: ReadonlyArray<FixEdit>;
  readonly rejected: ReadonlyArray<{ readonly edit: FixEdit; readonly reason: RejectionReason }>;
}

export function rewriteJavascript(input: RewriteJsInput): RewriteJsResult {
  const { parsedFile, edits, forbiddenRanges } = input;
  if (parsedFile.dialect !== "babel") {
    throw new TypeError(`rewriteJavascript: expected dialect "babel", got "${parsedFile.dialect}"`);
  }
  if (parsedFile.parse_error !== null) {
    throw new Error(
      `rewriteJavascript: refusing to rewrite ${parsedFile.file_path} — parse error: ${parsedFile.parse_error.message}`,
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

// D-07 single-line constraint: count `\n` between start and end (exclusive of end).
function spansMultipleLines(source: string, startByte: number, endByte: number): boolean {
  for (let i = startByte; i < endByte; i++) {
    if (source.charCodeAt(i) === 0x0a) return true;
  }
  return false;
}
