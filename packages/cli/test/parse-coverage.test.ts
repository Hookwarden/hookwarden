import type { ScanMetadata } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { evaluateParseCoverage } from "../src/parse-coverage.js";

function makeMeta(overrides: Partial<ScanMetadata>): ScanMetadata {
  return {
    engine_version: "0.1.0",
    engine_commit_sha: null,
    rule_pack_version: "0.1.0",
    rule_pack_content_hash: "sha256:abc",
    scanned_at: "2026-05-01T00:00:00.000Z",
    parse_errors_count: 0,
    parsed_files_count: 100,
    total_files_count: 100,
    parse_candidates_count: 100,
    ...overrides,
  };
}

describe("evaluateParseCoverage", () => {
  it("100% parsed at min 0.95 → ratio 1, not below", () => {
    const r = evaluateParseCoverage(
      makeMeta({ parse_candidates_count: 100, parsed_files_count: 100 }),
      0.95,
    );
    expect(r.ratio).toBe(1);
    expect(r.belowMin).toBe(false);
    expect(r.message).toBeNull();
  });

  it("95% parsed at min 0.95 → not below (boundary inclusive)", () => {
    const r = evaluateParseCoverage(
      makeMeta({ parse_candidates_count: 100, parsed_files_count: 95 }),
      0.95,
    );
    expect(r.ratio).toBe(0.95);
    expect(r.belowMin).toBe(false);
    expect(r.message).toBeNull();
  });

  it("94% parsed at min 0.95 → below; message has all four substrings (D-65)", () => {
    const r = evaluateParseCoverage(
      makeMeta({ parse_candidates_count: 100, parsed_files_count: 94 }),
      0.95,
    );
    expect(r.belowMin).toBe(true);
    expect(r.message).not.toBeNull();
    expect(r.message).toContain("94.0%");
    expect(r.message).toContain("95.0%");
    expect(r.message).toContain("6 files unparseable");
    expect(r.message).toContain("Likely toolchain mismatch");
  });

  it("zero candidates → trivially passes (ratio 1, not below)", () => {
    const r = evaluateParseCoverage(
      makeMeta({ parse_candidates_count: 0, parsed_files_count: 0 }),
      0.95,
    );
    expect(r.ratio).toBe(1);
    expect(r.belowMin).toBe(false);
    expect(r.message).toBeNull();
  });

  it("min=0 disables the gate (even with 1% coverage)", () => {
    const r = evaluateParseCoverage(
      makeMeta({ parse_candidates_count: 100, parsed_files_count: 1 }),
      0,
    );
    expect(r.belowMin).toBe(false);
    expect(r.message).toBeNull();
  });

  it("min=1.0 (strictest) — 99% parsed → below", () => {
    const r = evaluateParseCoverage(
      makeMeta({ parse_candidates_count: 100, parsed_files_count: 99 }),
      1.0,
    );
    expect(r.belowMin).toBe(true);
    expect(r.message).not.toBeNull();
  });

  it("D-64: ratio uses parse_candidates_count, NOT total_files_count", () => {
    // total_files_count=1000 would make the ratio 0.095 if it were used as denominator,
    // which would trigger belowMin. Using parse_candidates_count=100 gives ratio=0.95 (passes).
    const r = evaluateParseCoverage(
      makeMeta({
        total_files_count: 1000,
        parse_candidates_count: 100,
        parsed_files_count: 95,
      }),
      0.95,
    );
    expect(r.ratio).toBe(0.95);
    expect(r.candidates).toBe(100);
    expect(r.parsed).toBe(95);
    expect(r.belowMin).toBe(false);
  });
});
