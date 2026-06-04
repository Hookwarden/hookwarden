// Phase 28 LEAK-06 — liveness facet rendering (SARIF property + text tag).

import type { Finding, ScanResult } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { renderFindings } from "../src/render/findings.js";
import { renderSarif } from "../src/render/sarif.js";

function mkFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    rule_id: "github/hardcoded-secret-prefix",
    provider: "github",
    severity: "high",
    state: "not-verified",
    file_path: "app/webhook.ts",
    location: { line: 1, col: 1, end_line: 1, end_col: 10 },
    snippet: "<SECRET_LITERAL>",
    handler_id: "h1",
    primary_location_line_hash: "a".repeat(64),
    message: "hardcoded secret",
    metadata: {},
    ...overrides,
  };
}

function mkResult(findings: Finding[]): ScanResult {
  return {
    findings,
    inventory: [],
    metadata: {
      engine_version: "1.0.0",
      engine_commit_sha: null,
      rule_pack_version: "1.0.0",
      rule_pack_content_hash: "sha256:0",
      scanned_at: "2026-06-04T00:00:00.000Z",
      parse_errors_count: 0,
      parsed_files_count: 1,
      total_files_count: 1,
      parse_candidates_count: 1,
    },
  };
}

describe("SARIF liveness property (D-08)", () => {
  it("every result carries properties.hookwarden-liveness (default unverified)", () => {
    const sarif = JSON.parse(
      renderSarif({ scanResult: mkResult([mkFinding()]), ruleSet: null, stale: [] }),
    ) as {
      runs: Array<{ results: Array<{ ruleId: string; properties: Record<string, string> }> }>;
    };
    const result = sarif.runs[0]?.results[0];
    expect(result?.properties["hookwarden-liveness"]).toBe("unverified");
    // Rule id is unchanged (liveness is a property, never a new rule id).
    expect(result?.ruleId).toBe("github/hardcoded-secret-prefix");
  });

  it("reflects a probed verdict when metadata carries one", () => {
    const sarif = JSON.parse(
      renderSarif({
        scanResult: mkResult([mkFinding({ metadata: { liveness: "live" } })]),
        ruleSet: null,
        stale: [],
      }),
    ) as { runs: Array<{ results: Array<{ properties: Record<string, string> }> }> };
    expect(sarif.runs[0]?.results[0]?.properties["hookwarden-liveness"]).toBe("live");
  });
});

describe("text renderer liveness tag", () => {
  const opts = { useAnsi: false, cwd: "/repo", verbose: false };

  it("tags a live leak finding inline", () => {
    const out = renderFindings(
      mkResult([mkFinding({ metadata: { liveness: "live" } })]),
      null,
      opts,
    );
    expect(out).toContain("[live]");
  });

  it("tags a dead leak finding inline", () => {
    const out = renderFindings(
      mkResult([mkFinding({ metadata: { liveness: "dead" } })]),
      null,
      opts,
    );
    expect(out).toContain("[dead]");
  });

  it("does NOT tag an unverified finding (default state stays clean)", () => {
    const out = renderFindings(
      mkResult([mkFinding({ metadata: { liveness: "unverified" } })]),
      null,
      opts,
    );
    expect(out).not.toContain("[unverified]");
  });
});
