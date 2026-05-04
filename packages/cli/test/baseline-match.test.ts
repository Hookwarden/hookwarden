import type { Finding } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import {
  applyBaseline,
  buildBaselineMatcher,
  detectRulePackDrift,
} from "../src/baseline/match.js";
import type { BaselineDocument, BaselinedFinding } from "../src/baseline/schema.js";

const BASELINED_AT = "2026-05-01T00:00:00.000Z";

function makeBaseline(findings: BaselinedFinding[], rule_pack_version = "0.1.0"): BaselineDocument {
  return {
    schema_version: "1.0",
    baselined_at: BASELINED_AT,
    engine_version: "0.1.0",
    rule_pack_version,
    rule_pack_content_hash: "sha256:abc",
    findings,
  };
}

function makeBaselined(
  ruleId: string,
  hash: string,
  filePath: string,
  line = 10,
): BaselinedFinding {
  return {
    primary_location_line_hash: hash,
    rule_id: ruleId,
    file_path: filePath,
    line,
    severity_at_baseline: "high",
    state_at_baseline: "verified",
  };
}

function makeFinding(
  ruleId: string,
  hash: string,
  filePath: string,
  line = 10,
): Finding {
  return {
    id: `id-${hash}`,
    rule_id: ruleId,
    provider: "stripe",
    severity: "high",
    state: "verified",
    file_path: filePath,
    location: { line, col: 1, end_line: line, end_col: 10 },
    snippet: "<snippet>",
    handler_id: null,
    primary_location_line_hash: hash,
    message: "test finding",
    metadata: {},
  };
}

describe("buildBaselineMatcher", () => {
  it("returns an empty matcher for an empty baseline", () => {
    const m = buildBaselineMatcher(makeBaseline([]));
    expect(m.index.size).toBe(0);
  });

  it("indexes baseline findings under key 'rule_id|hash'", () => {
    const m = buildBaselineMatcher(
      makeBaseline([makeBaselined("stripe/missing-verification", "h1", "src/a.ts")]),
    );
    expect(m.index.size).toBe(1);
    expect(m.index.get("stripe/missing-verification|h1")).toBeDefined();
  });
});

describe("applyBaseline", () => {
  it("returns the finding unchanged when not in baseline (drift_note null)", () => {
    const matcher = buildBaselineMatcher(
      makeBaseline([makeBaselined("stripe/missing-verification", "h1", "src/a.ts")]),
    );
    const finding = makeFinding("github/missing-secret", "h2", "src/b.ts");
    const result = applyBaseline(finding, matcher);
    expect(result.finding).toBe(finding);
    expect(result.finding.suppressed).toBeUndefined();
    expect(result.drift_note).toBeNull();
  });

  it("suppresses with source=baseline when (rule_id, hash, file_path) all match", () => {
    const matcher = buildBaselineMatcher(
      makeBaseline([makeBaselined("stripe/missing-verification", "h1", "src/a.ts")]),
    );
    const finding = makeFinding("stripe/missing-verification", "h1", "src/a.ts");
    const result = applyBaseline(finding, matcher);
    expect(result.finding.suppressed).toEqual({
      source: "baseline",
      baselined_at: BASELINED_AT,
    });
    expect(result.drift_note).toBeNull();
  });

  it("file-path drift still suppresses AND surfaces a drift_note containing both paths", () => {
    const matcher = buildBaselineMatcher(
      makeBaseline([makeBaselined("stripe/missing-verification", "h1", "src/a.ts")]),
    );
    const finding = makeFinding("stripe/missing-verification", "h1", "src/moved.ts");
    const result = applyBaseline(finding, matcher);
    expect(result.finding.suppressed).toEqual({
      source: "baseline",
      baselined_at: BASELINED_AT,
    });
    expect(result.drift_note).not.toBeNull();
    expect(result.drift_note).toContain("src/a.ts");
    expect(result.drift_note).toContain("src/moved.ts");
    expect(result.drift_note).toContain("baseline file_path drift:");
  });
});

describe("detectRulePackDrift", () => {
  it("returns null when versions match", () => {
    const baseline = makeBaseline([], "1.0.0");
    expect(detectRulePackDrift(baseline, "1.0.0")).toBeNull();
  });

  it("returns a note mentioning both versions when they differ (D-70)", () => {
    const baseline = makeBaseline([], "1.0.0");
    const note = detectRulePackDrift(baseline, "1.1.0");
    expect(note).not.toBeNull();
    expect(note).toContain("note: baseline rule pack");
    expect(note).toContain("1.0.0");
    expect(note).toContain("1.1.0");
  });
});
