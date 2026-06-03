import type { Finding, Severity, SuppressedPayload, Verdict } from "@hookwarden/engine";
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

// Default state is "not-verified": the verdict for which gating is driven purely by severity.
// State-aware gating (verified never gates; manual-review gates only at low/info) is exercised
// by the dedicated "state-aware gating" block below.
function makeFinding(
  severity: Severity,
  suppressed?: SuppressedPayload | null,
  state: Verdict = "not-verified",
): Finding {
  return {
    id: `id-${severity}-${state}`,
    rule_id: "stripe/missing-verification",
    provider: "stripe",
    severity,
    state,
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

  it("counts parse-error findings (engine/parse-error, severity=high, state=manual-review) at --fail-on high — an unparseable file is a blind spot, not a soft manual-review verdict", () => {
    // Real parse-error findings are state="manual-review" (the engine can't classify a file it
    // can't parse). They must STILL gate by severity, unlike verification manual-review findings.
    const parseError: Finding = {
      ...makeFinding("high", null, "manual-review"),
      rule_id: "engine/parse-error",
    };
    expect(countActiveAtOrAbove([parseError], "high")).toBe(1);
  });
});

// State-aware gating: exit-code behavior must match the documented summary legend
// ("manual-review ... does not fail the build by default (use --fail-on low to gate)").
// A `verified` finding is a positive signal and must never gate; a `manual-review`
// finding gates only at --fail-on low/info; `not-verified` always gates by severity.
describe("countActiveAtOrAbove — state-aware gating", () => {
  it("verified-state findings NEVER count, even a critical at --fail-on critical", () => {
    const findings = [makeFinding("critical", null, "verified")];
    expect(countActiveAtOrAbove(findings, "critical")).toBe(0);
  });

  it("verified-state info finding does not gate even at --fail-on info (correct handler ≠ build failure)", () => {
    const findings = [makeFinding("info", null, "verified")];
    expect(countActiveAtOrAbove(findings, "info")).toBe(0);
  });

  it("manual-review high finding does NOT gate at the default --fail-on high", () => {
    const findings = [makeFinding("high", null, "manual-review")];
    expect(countActiveAtOrAbove(findings, "high")).toBe(0);
  });

  it("manual-review high finding DOES gate at --fail-on low (per the documented contract)", () => {
    const findings = [makeFinding("high", null, "manual-review")];
    expect(countActiveAtOrAbove(findings, "low")).toBe(1);
  });

  it("manual-review critical finding does not gate at high but gates at low", () => {
    const findings = [makeFinding("critical", null, "manual-review")];
    expect(countActiveAtOrAbove(findings, "high")).toBe(0);
    expect(countActiveAtOrAbove(findings, "low")).toBe(1);
  });

  it("not-verified critical always gates at the default --fail-on high", () => {
    const findings = [makeFinding("critical", null, "not-verified")];
    expect(countActiveAtOrAbove(findings, "high")).toBe(1);
  });

  it("mixed report: only the not-verified critical gates at --fail-on high", () => {
    const findings = [
      makeFinding("critical", null, "verified"), // positive signal — never gates
      makeFinding("critical", null, "not-verified"), // real bug — gates
      makeFinding("high", null, "manual-review"), // needs human — gates only at low
    ];
    expect(countActiveAtOrAbove(findings, "high")).toBe(1);
  });
});
