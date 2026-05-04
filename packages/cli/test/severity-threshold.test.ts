import type { Finding, Severity, SuppressedPayload } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { countActiveAtOrAbove, isAtOrAbove } from "../src/severity-threshold.js";

const SEVERITIES: ReadonlyArray<Severity> = ["critical", "high", "medium", "low", "info"];

// rank reference: critical=0, high=1, medium=2, low=3, info=4
const RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function makeFinding(severity: Severity, suppressed?: SuppressedPayload | null): Finding {
  return {
    id: `id-${severity}`,
    rule_id: "stripe/missing-verification",
    provider: "stripe",
    severity,
    state: "verified",
    file_path: "src/a.ts",
    location: { line: 1, col: 1, end_line: 1, end_col: 10 },
    snippet: "<snippet>",
    handler_id: null,
    primary_location_line_hash: `h-${severity}`,
    message: "test",
    metadata: {},
    ...(suppressed !== undefined ? { suppressed } : {}),
  };
}

describe("isAtOrAbove", () => {
  it("critical >= high → true", () => {
    expect(isAtOrAbove("critical", "high")).toBe(true);
  });

  it("high >= high → true (boundary inclusive)", () => {
    expect(isAtOrAbove("high", "high")).toBe(true);
  });

  it("medium >= high → false", () => {
    expect(isAtOrAbove("medium", "high")).toBe(false);
  });

  it("info >= low → false", () => {
    expect(isAtOrAbove("info", "low")).toBe(false);
  });

  it("critical >= critical → true", () => {
    expect(isAtOrAbove("critical", "critical")).toBe(true);
  });

  describe("5×5 matrix", () => {
    for (const sev of SEVERITIES) {
      for (const thr of SEVERITIES) {
        const expected = RANK[sev] <= RANK[thr];
        it(`isAtOrAbove("${sev}", "${thr}") → ${expected}`, () => {
          expect(isAtOrAbove(sev, thr)).toBe(expected);
        });
      }
    }
  });
});

describe("countActiveAtOrAbove", () => {
  it("counts findings at or above the threshold (active only)", () => {
    const findings = [makeFinding("critical"), makeFinding("high"), makeFinding("low")];
    expect(countActiveAtOrAbove(findings, "high")).toBe(2);
  });

  it("D-66: suppressed findings never count, regardless of severity", () => {
    const findings = [
      makeFinding("critical", { source: "inline" }),
      makeFinding("high"),
      makeFinding("high"),
    ];
    expect(countActiveAtOrAbove(findings, "high")).toBe(2);
  });

  it("returns 0 for an empty findings array", () => {
    expect(countActiveAtOrAbove([], "info")).toBe(0);
  });

  it("D-66: returns 0 when ALL findings are suppressed (any source)", () => {
    const findings = [
      makeFinding("critical", { source: "inline" }),
      makeFinding("high", { source: "ignore", pattern: "src/*.ts" }),
      makeFinding("low", { source: "baseline", baselined_at: "2026-05-01T00:00:00.000Z" }),
    ];
    expect(countActiveAtOrAbove(findings, "low")).toBe(0);
  });

  it("counts parse-error findings (engine/parse-error rule_id, severity=high) — they are findings, not metadata", () => {
    const parseError: Finding = {
      ...makeFinding("high"),
      rule_id: "engine/parse-error",
    };
    expect(countActiveAtOrAbove([parseError], "high")).toBe(1);
  });
});
