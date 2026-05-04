import type { Finding } from "@hookwarden/engine";
import ignore from "ignore";
import { describe, expect, it } from "vitest";
import type { IgnoreFilter } from "../src/suppress/ignore-file.js";
import type {
  InlineSuppressionEntry,
  InlineSuppressions,
} from "../src/suppress/inline-comments.js";
import type { BaselineLike } from "../src/suppress/merge.js";
import { detectStale } from "../src/suppress/stale.js";

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

function makeRealIgnoreFilter(patterns: ReadonlyArray<string>): IgnoreFilter {
  const positive = patterns.filter((p) => !p.startsWith("!"));
  const fullIgnore = ignore().add(patterns as string[]);
  const single = positive.map((pattern) => ({
    pattern,
    matcher: ignore().add(pattern),
  }));
  return {
    patterns,
    matches: (p: string) => {
      if (!fullIgnore.ignores(p)) return null;
      for (let i = single.length - 1; i >= 0; i -= 1) {
        const sm = single[i];
        if (sm?.matcher.ignores(p)) return sm.pattern;
      }
      return null;
    },
    matchesAll: (p: string) => {
      if (!fullIgnore.ignores(p)) return [];
      return single.filter((sm) => sm.matcher.ignores(p)).map((sm) => sm.pattern);
    },
  };
}

describe("detectStale", () => {
  it("flags an inline entry whose target line has no finding", () => {
    const entry: InlineSuppressionEntry = {
      file_path: "src/a.ts",
      line: 11,
      rule_ids: ["stripe/missing-verification"],
      form: "disable-next-line",
      comment_line: 10,
    };
    const inline: InlineSuppressions = { perLine: new Map(), entries: [entry] };
    const stale = detectStale([], inline, null, null);
    expect(stale).toHaveLength(1);
    expect(stale[0]?.source).toBe("inline");
    expect(stale[0]?.line).toBe(10);
  });

  it("flags an ignore pattern that matches no finding", () => {
    const filter = makeRealIgnoreFilter(["unused/**"]);
    const stale = detectStale([], emptyInline, filter, null);
    expect(stale).toEqual([{ source: "ignore", pattern: "unused/**" }]);
  });

  it("flags a baseline entry with no matching current finding", () => {
    const baseline: BaselineLike = {
      baselined_at: "2026-05-01T00:00:00Z",
      findings: [{ rule_id: "stripe/x", primary_location_line_hash: "h".repeat(64) }],
    };
    const stale = detectStale([], emptyInline, null, baseline);
    expect(stale).toEqual([{ source: "baseline", rule_id: "stripe/x" }]);
  });

  it("returns an empty array when every source attaches to a finding", () => {
    const finding = mockFinding();
    const inline: InlineSuppressions = {
      perLine: new Map(),
      entries: [
        {
          file_path: finding.file_path,
          line: finding.location.line,
          rule_ids: [finding.rule_id],
          form: "disable-line",
          comment_line: finding.location.line,
        },
      ],
    };
    const filter = makeRealIgnoreFilter(["src/**"]);
    const baseline: BaselineLike = {
      baselined_at: "2026-05-01T00:00:00Z",
      findings: [
        {
          rule_id: finding.rule_id,
          primary_location_line_hash: finding.primary_location_line_hash,
        },
      ],
    };
    expect(detectStale([finding], inline, filter, baseline)).toEqual([]);
  });

  it("counts an ignore pattern as USED when it matches a finding (even when other sources also matched)", () => {
    const finding = mockFinding();
    const filter = makeRealIgnoreFilter(["src/**"]);
    const stale = detectStale([finding], emptyInline, filter, null);
    expect(stale.find((s) => s.pattern === "src/**")).toBeUndefined();
  });

  it("attributes BOTH overlapping ignore patterns when one finding matches multiple", () => {
    const finding = mockFinding({ file_path: "vendor/lib.ts" });
    const filter = makeRealIgnoreFilter(["vendor/**", "vendor/lib.ts"]);
    const stale = detectStale([finding], emptyInline, filter, null);
    expect(stale.find((s) => s.pattern === "vendor/**")).toBeUndefined();
    expect(stale.find((s) => s.pattern === "vendor/lib.ts")).toBeUndefined();
  });

  it("processes 5000 findings × 25 patterns in < 250ms (no O(P²×F) regression)", () => {
    const findings: Finding[] = Array.from({ length: 5000 }, (_, i) =>
      mockFinding({
        id: `f${i}`,
        file_path: `src/module-${i % 50}/file-${i}.ts`,
        location: { line: i + 1, col: 0, end_line: i + 1, end_col: 5 },
      }),
    );
    const patterns = Array.from({ length: 25 }, (_, i) => `src/module-${i}/**`);
    const filter = makeRealIgnoreFilter(patterns);
    const t0 = performance.now();
    detectStale(findings, emptyInline, filter, null);
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(250);
  });
});
