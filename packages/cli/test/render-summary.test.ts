import type { Finding, ScanMetadata, ScanResult, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { renderSummary } from "../src/render/summary.js";

const META: ScanMetadata = {
  engine_version: "0.0.1",
  engine_commit_sha: null,
  rule_pack_version: "0.0.1",
  rule_pack_content_hash: "deadbeef",
  scanned_at: "2026-05-03T00:00:00.000Z",
  parse_errors_count: 0,
  parsed_files_count: 1,
  total_files_count: 1,
};

const baseHandler: WebhookHandler = {
  id: "h1",
  framework: "express",
  framework_version: null,
  route_pattern: "/webhooks/stripe",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 10, col: 1, end_line: 12, end_col: 1 },
  handler_function_name: "handleStripe",
  provider: "stripe",
  verification_state: "not-verified",
  evidence: [],
  middleware_chain: [],
  reachable_symbols: [],
  findings_ref: [],
  redacted_snippet: "",
};

const baseFinding: Finding = {
  id: "f1",
  rule_id: "stripe/missing-signature-verification",
  provider: "stripe",
  severity: "critical",
  state: "not-verified",
  file_path: "src/server.ts",
  location: { line: 42, col: 3, end_line: 42, end_col: 5 },
  snippet: "",
  handler_id: "h1",
  primary_location_line_hash: "h1",
  message: "msg",
  metadata: {},
};

describe("renderSummary (D-44)", () => {
  it("renders all severity counts + manual-review + handlers/files + scan-stats", () => {
    const result: ScanResult = {
      findings: [
        { ...baseFinding, id: "f1", severity: "critical", state: "not-verified" },
        { ...baseFinding, id: "f2", severity: "high", state: "not-verified" },
        { ...baseFinding, id: "f3", severity: "medium", state: "manual-review" },
      ],
      inventory: [
        baseHandler,
        { ...baseHandler, id: "h2", file_path: "src/gh.ts", route_pattern: "/webhooks/github" },
      ],
      metadata: { ...META, parse_errors_count: 2 },
    };
    const out = renderSummary(result, { useAnsi: false, durationMs: 1234 });
    expect(out).toContain("1 critical");
    expect(out).toContain("1 high");
    expect(out).toContain("1 medium");
    expect(out).toContain("0 low");
    expect(out).toContain("0 info");
    expect(out).toContain("1 manual-review");
    expect(out).toContain("2 webhook handlers across 2 files");
    expect(out).toContain("Scanned in 1.2 s");
    expect(out).toContain("2 parse errors");
    expect(out).toContain("engine v0.0.1");
    expect(out).toContain("rules v0.0.1");
  });

  it("singularizes '1 webhook handler', '1 file', '1 parse error'", () => {
    const result: ScanResult = {
      findings: [],
      inventory: [baseHandler],
      metadata: { ...META, parse_errors_count: 1 },
    };
    const out = renderSummary(result, { useAnsi: false });
    expect(out).toContain("1 webhook handler across 1 file");
    expect(out).not.toContain("1 webhook handlers");
    expect(out).not.toContain("1 files");
    expect(out).toContain("1 parse error ");
    expect(out).not.toContain("1 parse errors");
  });

  it("omits 'Scanned in' prefix when durationMs is undefined", () => {
    const result: ScanResult = {
      findings: [],
      inventory: [],
      metadata: META,
    };
    const out = renderSummary(result, { useAnsi: false });
    expect(out).not.toContain("Scanned in");
    expect(out).toContain("0 parse errors");
  });

  it("counts manual-review across any severity bucket (state-based, not severity-based)", () => {
    const result: ScanResult = {
      findings: [
        { ...baseFinding, id: "f1", severity: "info", state: "manual-review" },
        { ...baseFinding, id: "f2", severity: "low", state: "manual-review" },
      ],
      inventory: [],
      metadata: META,
    };
    const out = renderSummary(result, { useAnsi: false });
    expect(out).toContain("2 manual-review");
  });

  it("counts unique files in handlers (handlers in same file count once)", () => {
    const result: ScanResult = {
      findings: [],
      inventory: [baseHandler, { ...baseHandler, id: "h2", route_pattern: "/webhooks/github" }],
      metadata: META,
    };
    const out = renderSummary(result, { useAnsi: false });
    expect(out).toContain("2 webhook handlers across 1 file");
  });
});

describe("renderSummary — Phase 4 footer extension", () => {
  const emptyResult: ScanResult = { findings: [], inventory: [], metadata: META };

  it("Phase 3 backward-compat: zero suppressed/stale/diff/drift renders without new segments", () => {
    const out = renderSummary(emptyResult, { useAnsi: false, durationMs: 1000 });
    expect(out).not.toContain("pre-existing");
    expect(out).not.toContain("suppressed");
    expect(out).not.toContain(" stale");
    expect(out).not.toContain(" vs ");
    expect(out).not.toContain("rule pack");
  });

  it("includes 'N pre-existing' segment when preExistingCount > 0", () => {
    const out = renderSummary(emptyResult, {
      useAnsi: false,
      durationMs: 1000,
      preExistingCount: 247,
    });
    expect(out).toContain("247 pre-existing");
  });

  it("includes 'N suppressed' when suppressedCount > 0", () => {
    const out = renderSummary(emptyResult, {
      useAnsi: false,
      durationMs: 1000,
      suppressedCount: 12,
    });
    expect(out).toContain("12 suppressed");
  });

  it("includes 'N stale' when staleCount > 0", () => {
    const out = renderSummary(emptyResult, {
      useAnsi: false,
      durationMs: 1000,
      staleCount: 3,
    });
    expect(out).toContain("3 stale");
  });

  it("includes '(use --verbose to view)' hint when suppressed+stale > 0 and not verbose", () => {
    const out = renderSummary(emptyResult, {
      useAnsi: false,
      durationMs: 1000,
      suppressedCount: 5,
      staleCount: 1,
    });
    expect(out).toContain("(use --verbose to view)");
  });

  it("hides the '--verbose' hint when verbose=true", () => {
    const out = renderSummary(emptyResult, {
      useAnsi: false,
      durationMs: 1000,
      suppressedCount: 5,
      verbose: true,
    });
    expect(out).not.toContain("(use --verbose to view)");
  });

  it("line 2 includes 'X / Y candidates parsed (Z% coverage)' when both fields provided", () => {
    const out = renderSummary(emptyResult, {
      useAnsi: false,
      durationMs: 1000,
      parseCandidatesCount: 1234,
      parsedFilesCount: 1180,
    });
    expect(out).toContain("1180 / 1234 candidates parsed");
    expect(out).toContain("(95.6% coverage)");
  });

  it("line 2 includes 'vs <ref>' when diffBase provided", () => {
    const out = renderSummary(emptyResult, {
      useAnsi: false,
      durationMs: 1000,
      diffBase: "origin/main:abc123",
    });
    expect(out).toContain("vs origin/main:abc123");
  });

  it("appends '(rule pack X.Y → X.Z)' line when rulePackDrift provided", () => {
    const out = renderSummary(emptyResult, {
      useAnsi: false,
      durationMs: 1000,
      rulePackDrift: { from: "0.3.0", to: "0.4.0" },
    });
    expect(out).toContain("rule pack 0.3.0 → 0.4.0");
  });

  it("D-66: suppressed findings do NOT contribute to severity counts", () => {
    const result: ScanResult = {
      findings: [
        { ...baseFinding, severity: "critical", suppressed: { source: "inline" } },
        { ...baseFinding, id: "f2", severity: "high", primary_location_line_hash: "h2" },
      ],
      inventory: [],
      metadata: META,
    };
    const out = renderSummary(result, { useAnsi: false, durationMs: 1000 });
    // Critical was suppressed → tally shows 0 critical, 1 high.
    expect(out).toContain("0 critical");
    expect(out).toContain("1 high");
  });
});
