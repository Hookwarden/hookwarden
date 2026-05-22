// Phase 8.2 Plan 08 Task 1: D-19 conflict resolver — exact-string D-19 format assertion.
//
// The suggestion-string format is the load-bearing contract. Format drift breaks
// user trust. Tests assert byte-for-byte `===` equality on the suggestion field.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildD19Suggestion,
  resolveConflicts,
} from "../src/conflict-resolver.js";
import type { FixEdit } from "../src/index.js";

function mkEdit(overrides: Partial<FixEdit> & Pick<FixEdit, "startByte" | "endByte">): FixEdit {
  return {
    ruleId: "test/rule",
    routineId: "test-routine",
    filePath: "src/webhook.ts",
    start: { line: 1, col: 1 },
    end: { line: 1, col: 1 },
    before: "",
    after: "x",
    safety: "safe",
    ...overrides,
  };
}

describe("buildD19Suggestion — exact format (D-19 contract)", () => {
  it("emits the 2-rule canonical format byte-for-byte", () => {
    const result = buildD19Suggestion("src/webhook.ts", [
      "stripe/timing-unsafe-comparison",
      "stripe/missing-nullish-guard",
    ]);
    const expected =
      "hookwarden fix: 2 findings in src/webhook.ts have overlapping fix ranges.\n" +
      "Apply fixes one at a time:\n" +
      "  hookwarden fix src/webhook.ts --only stripe/timing-unsafe-comparison --write\n" +
      "  hookwarden fix src/webhook.ts --only stripe/missing-nullish-guard --write\n";
    expect(result).toBe(expected);
  });

  it("emits the 3-rule format with the same shape", () => {
    const result = buildD19Suggestion("src/webhook.ts", [
      "stripe/timing-unsafe-comparison",
      "stripe/missing-nullish-guard",
      "stripe/missing-secret-presence-check",
    ]);
    const expected =
      "hookwarden fix: 3 findings in src/webhook.ts have overlapping fix ranges.\n" +
      "Apply fixes one at a time:\n" +
      "  hookwarden fix src/webhook.ts --only stripe/timing-unsafe-comparison --write\n" +
      "  hookwarden fix src/webhook.ts --only stripe/missing-nullish-guard --write\n" +
      "  hookwarden fix src/webhook.ts --only stripe/missing-secret-presence-check --write\n";
    expect(result).toBe(expected);
  });
});

describe("resolveConflicts — positive cases", () => {
  it("3 non-overlapping edits → all applied; suggestion === null", () => {
    const edits = [
      mkEdit({ startByte: 0, endByte: 5, ruleId: "r1" }),
      mkEdit({ startByte: 10, endByte: 15, ruleId: "r2" }),
      mkEdit({ startByte: 20, endByte: 25, ruleId: "r3" }),
    ];
    const result = resolveConflicts(edits);
    expect(result.applied).toHaveLength(3);
    expect(result.rejected).toHaveLength(0);
    expect(result.suggestion).toBe(null);
  });

  it("Empty edits → empty applied, suggestion === null", () => {
    const result = resolveConflicts([]);
    expect(result.applied).toHaveLength(0);
    expect(result.suggestion).toBe(null);
  });
});

describe("resolveConflicts — overlap detection", () => {
  it("2 directly-overlapping edits → second rejected; suggestion = exact D-19 format", () => {
    const edits = [
      mkEdit({ startByte: 5, endByte: 15, ruleId: "stripe/timing-unsafe-comparison" }),
      mkEdit({ startByte: 10, endByte: 20, ruleId: "stripe/missing-nullish-guard" }),
    ];
    const result = resolveConflicts(edits);
    expect(result.applied).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toBe("overlap");
    const expected =
      "hookwarden fix: 2 findings in src/webhook.ts have overlapping fix ranges.\n" +
      "Apply fixes one at a time:\n" +
      "  hookwarden fix src/webhook.ts --only stripe/timing-unsafe-comparison --write\n" +
      "  hookwarden fix src/webhook.ts --only stripe/missing-nullish-guard --write\n";
    expect(result.suggestion).toBe(expected);
  });

  it("Adjacent edits (a.end === b.start) → both applied (half-open semantics)", () => {
    const edits = [
      mkEdit({ startByte: 0, endByte: 10, ruleId: "r1" }),
      mkEdit({ startByte: 10, endByte: 20, ruleId: "r2" }),
    ];
    const result = resolveConflicts(edits);
    expect(result.applied).toHaveLength(2);
    expect(result.suggestion).toBe(null);
  });
});

describe("D-19 format-drift guard (SOC2 evidence)", () => {
  it("conflict-resolver.ts source contains the canonical format string literally", () => {
    const sourcePath = path.resolve(__dirname, "../src/conflict-resolver.ts");
    const source = readFileSync(sourcePath, "utf-8");
    expect(source).toContain("findings in ${file} have overlapping fix ranges.");
    expect(source).toContain("Apply fixes one at a time:");
    expect(source).toContain("--only ${id} --write");
  });
});
