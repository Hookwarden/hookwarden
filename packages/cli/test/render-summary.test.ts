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
