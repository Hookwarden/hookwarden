// Phase 8.2 D-06: text-range substitution — the single code path for JS/TS,
// Python, and PHP rewrites in v0.5. No @babel/generator round-trip; bytes
// outside the edit range are preserved exactly.
//
// Pure: no fs / http / network / process / node:* (D-28).

export interface TextEdit {
  readonly start: number; // byte offset, inclusive
  readonly end: number; // byte offset, exclusive
  readonly replacement: string;
  readonly rule_id?: string; // optional — surfaced in overlap-error message
}

export function applyEdits(
  sourceText: string,
  edits: ReadonlyArray<TextEdit>,
): string {
  if (edits.length === 0) return sourceText;
  // 1. Validate every edit's range invariants.
  for (const edit of edits) {
    if (edit.start < 0) {
      throw new RangeError(
        `applyEdits: edit start ${edit.start} is negative${formatRule(edit)}`,
      );
    }
    if (edit.start > edit.end) {
      throw new RangeError(
        `applyEdits: edit start (${edit.start}) > end (${edit.end})${formatRule(edit)}`,
      );
    }
    if (edit.end > sourceText.length) {
      throw new RangeError(
        `applyEdits: edit end (${edit.end}) exceeds sourceText.length (${sourceText.length})${formatRule(edit)}`,
      );
    }
  }
  // 2. Sort right-to-left so each edit's slice math is unaffected by later edits.
  const sorted: TextEdit[] = [...edits].sort((a, b) => b.start - a.start);
  // 3. Pairwise overlap check after sort (descending by start).
  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i] as TextEdit;
    const next = sorted[i + 1] as TextEdit;
    // sorted[i].start > sorted[i+1].start; overlap iff next.end > curr.start.
    if (next.end > curr.start) {
      throw new RangeError(
        `applyEdits: overlapping edits — [${next.start},${next.end})${formatRule(next)} and [${curr.start},${curr.end})${formatRule(curr)}`,
      );
    }
  }
  // 4. Apply.
  let result = sourceText;
  for (const edit of sorted) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  return result;
}

function formatRule(edit: TextEdit): string {
  return edit.rule_id ? ` (rule_id=${edit.rule_id})` : "";
}
