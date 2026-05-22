// Phase 8.2 D-19: multi-fix conflict resolution.
//
// Sequential apply with overlap detection. When two FixEdits target overlapping
// byte ranges in the same file, emit the canonical D-19 suggestion string so
// the user can apply the fixes one at a time via `--only <rule-id>`.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { FixEdit } from "./index.js";

export type RejectionReason = "overlap" | "loop" | "post-reparse-regression" | "no-codegen";

export interface ConflictResolution {
  readonly applied: ReadonlyArray<FixEdit>;
  readonly rejected: ReadonlyArray<{ readonly edit: FixEdit; readonly reason: RejectionReason }>;
  readonly suggestion: string | null;
}

export function resolveConflicts(edits: ReadonlyArray<FixEdit>): ConflictResolution {
  // Group edits by file. Within each file, detect direct byte-range overlap.
  const applied: FixEdit[] = [];
  const rejected: Array<{ edit: FixEdit; reason: RejectionReason }> = [];
  const byFile = new Map<string, FixEdit[]>();
  for (const edit of edits) {
    const list = byFile.get(edit.filePath) ?? [];
    list.push(edit);
    byFile.set(edit.filePath, list);
  }
  for (const [filePath, fileEdits] of byFile) {
    const conflictingRuleIds: string[] = [];
    const fileApplied: FixEdit[] = [];
    for (const edit of fileEdits) {
      const overlap = fileApplied.find((a) => rangesOverlap(a, edit));
      if (overlap !== undefined) {
        // Both the overlap-pair's rule_ids become part of the suggestion.
        if (!conflictingRuleIds.includes(overlap.ruleId)) conflictingRuleIds.push(overlap.ruleId);
        if (!conflictingRuleIds.includes(edit.ruleId)) conflictingRuleIds.push(edit.ruleId);
        rejected.push({ edit, reason: "overlap" });
      } else {
        fileApplied.push(edit);
        applied.push(edit);
      }
    }
    if (conflictingRuleIds.length > 0) {
      return {
        applied,
        rejected,
        suggestion: buildD19Suggestion(filePath, conflictingRuleIds),
      };
    }
  }
  return { applied, rejected, suggestion: null };
}

function rangesOverlap(a: FixEdit, b: FixEdit): boolean {
  // Half-open intersection. Zero-width insertions (start === end) on the same
  // line are treated as non-overlapping unless start equals exactly — even
  // then, two zero-width inserts at the same offset are surfaced as overlap
  // because applying both deterministically loses one.
  if (a.startByte === a.endByte && b.startByte === b.endByte) {
    return a.startByte === b.startByte;
  }
  return a.startByte < b.endByte && b.startByte < a.endByte;
}

/**
 * D-19 canonical suggestion format. Format-byte-stable — drift breaks the user
 * trust contract; tests assert exact `===` equality, not substring/regex.
 */
export function buildD19Suggestion(file: string, ruleIds: ReadonlyArray<string>): string {
  const header = `hookwarden fix: ${ruleIds.length} findings in ${file} have overlapping fix ranges.\nApply fixes one at a time:\n`;
  const lines = ruleIds.map((id) => `  hookwarden fix ${file} --only ${id} --write\n`).join("");
  return header + lines;
}
