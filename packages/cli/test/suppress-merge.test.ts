import type { Finding } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import type { IgnoreFilter } from "../src/suppress/ignore-file.js";
import type { InlineSuppressions } from "../src/suppress/inline-comments.js";
import { type BaselineLike, annotateSuppressions } from "../src/suppress/merge.js";

function mockFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    rule_id: "stripe/missing-verification",
    provider: "stripe",
    severity: "high",
    state: "not-verified",
    file_path: "src/webhook.ts",
    location: { line: 10, col: 1, end_line: 10, end_col: 5 },
    snippet: "",
    handler_id: null,
    primary_location_line_hash: "h".repeat(64),
    message: "",
    metadata: {},
    ...overrides,
  } as Finding;
}

const emptyInline: InlineSuppressions = { perLine: new Map(), entries: [] };

function inlineWith(file: string, line: number, ruleId: string): InlineSuppressions {
  const set = new Set<string>([ruleId]);
  const lineMap = new Map<number, ReadonlySet<string>>([[line, set]]);
  return { perLine: new Map([[file, lineMap]]), entries: [] };
}

function ignoreWith(pattern: string, matches: string): IgnoreFilter {
  return {
    patterns: [pattern],
    matches: (p: string) => (p === matches ? pattern : null),
    matchesAll: (p: string) => (p === matches ? [pattern] : []),
  };
}

describe("annotateSuppressions", () => {
  it("returns suppressed: null when no source matches", () => {
    const result = annotateSuppressions(mockFinding(), emptyInline, null, null);
    expect(result.suppressed).toBeNull();
  });

  it("matches inline source by file + line + rule_id", () => {
    const inline = inlineWith("src/webhook.ts", 10, "stripe/missing-verification");
    const result = annotateSuppressions(mockFinding(), inline, null, null);
    expect(result.suppressed).toEqual({ source: "inline" });
  });

  it("matches ignore source by file_path and surfaces the matched pattern", () => {
    const filter = ignoreWith("src/**", "src/webhook.ts");
    const result = annotateSuppressions(mockFinding(), emptyInline, filter, null);
    expect(result.suppressed).toEqual({ source: "ignore", pattern: "src/**" });
  });

  it("matches baseline source by (rule_id, primary_location_line_hash)", () => {
    const baseline: BaselineLike = {
      baselined_at: "2026-05-01T00:00:00Z",
      findings: [
        { rule_id: "stripe/missing-verification", primary_location_line_hash: "h".repeat(64) },
      ],
    };
    const result = annotateSuppressions(mockFinding(), emptyInline, null, baseline);
    expect(result.suppressed).toEqual({
      source: "baseline",
      baselined_at: "2026-05-01T00:00:00Z",
    });
  });

  it("inline beats ignore beats baseline (precedence)", () => {
    const inline = inlineWith("src/webhook.ts", 10, "stripe/missing-verification");
    const filter = ignoreWith("src/**", "src/webhook.ts");
    const baseline: BaselineLike = {
      baselined_at: "2026-05-01T00:00:00Z",
      findings: [
        { rule_id: "stripe/missing-verification", primary_location_line_hash: "h".repeat(64) },
      ],
    };
    const result = annotateSuppressions(mockFinding(), inline, filter, baseline);
    expect(result.suppressed).toEqual({ source: "inline" });
  });

  it("ignore beats baseline when inline is absent", () => {
    const filter = ignoreWith("src/**", "src/webhook.ts");
    const baseline: BaselineLike = {
      baselined_at: "2026-05-01T00:00:00Z",
      findings: [
        { rule_id: "stripe/missing-verification", primary_location_line_hash: "h".repeat(64) },
      ],
    };
    const result = annotateSuppressions(mockFinding(), emptyInline, filter, baseline);
    expect(result.suppressed?.source).toBe("ignore");
  });
});
