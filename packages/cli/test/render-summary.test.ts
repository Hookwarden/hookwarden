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
  it("renders non-zero severity counts + manual-review + handlers/files + scan-stats (zero tiers trimmed)", () => {
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
    // verbose:true surfaces the engine/rules versions in the footer.
    const out = renderSummary(result, { useAnsi: false, durationMs: 1234, verbose: true });
    expect(out).toContain("1 critical");
    expect(out).toContain("1 high");
    expect(out).toContain("1 medium");
    // Zero tiers are trimmed — a row of `0 low · 0 info` is noise that buries the real counts.
    expect(out).not.toContain("0 low");
    expect(out).not.toContain("0 info");
    expect(out).toContain("1 manual-review");
    expect(out).toContain("2 webhook handlers across 2 files");
    expect(out).toContain("Scanned in 1.2 s");
    expect(out).toContain("2 parse errors");
    expect(out).toContain("engine v0.0.1");
    expect(out).toContain("rules v0.0.1");
  });

  it("trims every zero tier — a single critical shows `Found 1 critical`, no zero segments", () => {
    const result: ScanResult = {
      findings: [{ ...baseFinding, id: "f1", severity: "critical", state: "not-verified" }],
      inventory: [baseHandler],
      metadata: { ...META },
    };
    const out = renderSummary(result, { useAnsi: false });
    expect(out).toContain("Found 1 critical");
    expect(out).not.toContain("0 high");
    expect(out).not.toContain("0 medium");
    expect(out).not.toContain("0 low");
    expect(out).not.toContain("0 info");
    // manual-review is a state subset, not a severity — omitted entirely when zero.
    expect(out).not.toContain("manual-review");
  });

  it("omits the manual-review segment when zero but keeps it when present", () => {
    const withMR: ScanResult = {
      findings: [{ ...baseFinding, id: "f1", severity: "high", state: "manual-review" }],
      inventory: [baseHandler],
      metadata: { ...META },
    };
    const out = renderSummary(withMR, { useAnsi: false });
    expect(out).toContain("Found 1 high");
    expect(out).toContain("1 manual-review");
    expect(out).not.toContain("0 manual-review");
  });

  it("colors each severity tally segment in its palette colour when useAnsi is true", () => {
    const result: ScanResult = {
      findings: [
        { ...baseFinding, id: "f1", severity: "critical", state: "not-verified" },
        { ...baseFinding, id: "f2", severity: "high", state: "not-verified" },
        { ...baseFinding, id: "f3", severity: "info", state: "verified" },
      ],
      inventory: [baseHandler],
      metadata: META,
    };
    const out = renderSummary(result, { useAnsi: true, durationMs: 10 });
    // 24-bit truecolor per severity (critical=#F43F5E, high=#F97316, info=#3B82F6),
    // not a plain-foreground tally.
    expect(out).toContain("\x1b[38;2;244;63;94m1 critical");
    expect(out).toContain("\x1b[38;2;249;115;22m1 high");
    expect(out).toContain("\x1b[38;2;59;130;246m1 info");
  });

  it("hides engine/rules versions by default (provenance is --verbose only)", () => {
    const result: ScanResult = {
      findings: [{ ...baseFinding, id: "f1", severity: "critical", state: "not-verified" }],
      inventory: [baseHandler],
      metadata: META,
    };
    const out = renderSummary(result, { useAnsi: false, durationMs: 1234 });
    expect(out).not.toContain("engine v");
    expect(out).not.toContain("rules v");
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
    expect(out).toContain("1 parse error");
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
    // Critical was suppressed → it does not count, so no critical segment appears
    // (zero tiers are trimmed); only the active high shows.
    expect(out).not.toContain("critical");
    expect(out).toContain("1 high");
  });

  it("manual-review legend: appears when ≥1 manual-review finding is in the report", () => {
    const result: ScanResult = {
      findings: [{ ...baseFinding, severity: "high", state: "manual-review" }],
      inventory: [],
      metadata: META,
    };
    const out = renderSummary(result, { useAnsi: false, durationMs: 1000 });
    expect(out).toContain("manual-review =");
    expect(out).toContain("does not fail the build by default");
    expect(out).toContain("--fail-on low");
  });

  it("NEGATIVE manual-review legend: omitted when zero manual-review findings", () => {
    const result: ScanResult = {
      findings: [{ ...baseFinding, severity: "high", state: "not-verified" }],
      inventory: [],
      metadata: META,
    };
    const out = renderSummary(result, { useAnsi: false, durationMs: 1000 });
    expect(out).not.toContain("manual-review =");
  });

  it("NEGATIVE manual-review legend: omitted on a clean scan (zero findings)", () => {
    const result: ScanResult = { findings: [], inventory: [], metadata: META };
    const out = renderSummary(result, { useAnsi: false, durationMs: 1000 });
    expect(out).not.toContain("manual-review =");
  });

  it("critical legend: appears when ≥1 critical finding", () => {
    const result: ScanResult = {
      findings: [{ ...baseFinding, severity: "critical", state: "not-verified" }],
      inventory: [],
      metadata: META,
    };
    const out = renderSummary(result, { useAnsi: false, durationMs: 1000 });
    expect(out).toContain("critical = concrete vulnerability");
    expect(out).toContain("Fails the build");
  });

  it("high legend: appears when ≥1 high finding", () => {
    const result: ScanResult = {
      findings: [{ ...baseFinding, severity: "high", state: "not-verified" }],
      inventory: [],
      metadata: META,
    };
    const out = renderSummary(result, { useAnsi: false, durationMs: 1000 });
    expect(out).toContain("high = exploitable verification weakness");
    expect(out).toContain("timing-unsafe");
  });

  it("info legend: appears when ≥1 info finding (positive signal callout)", () => {
    const result: ScanResult = {
      findings: [{ ...baseFinding, severity: "info", state: "verified" }],
      inventory: [],
      metadata: META,
    };
    const out = renderSummary(result, { useAnsi: false, durationMs: 1000 });
    expect(out).toContain("info = positive signal");
    expect(out).toContain("no action needed");
  });

  it("multiple legends: all non-zero tiers render together in tier order", () => {
    const result: ScanResult = {
      findings: [
        { ...baseFinding, id: "a", severity: "critical", state: "not-verified" },
        { ...baseFinding, id: "b", severity: "high", state: "not-verified" },
        { ...baseFinding, id: "c", severity: "high", state: "manual-review" },
      ],
      inventory: [],
      metadata: META,
    };
    const out = renderSummary(result, { useAnsi: false, durationMs: 1000 });
    expect(out).toContain("critical = ");
    expect(out).toContain("high = ");
    expect(out).toContain("manual-review = ");
    // Order: critical → high → manual-review (matches the inline tally line).
    const critIdx = out.indexOf("critical = ");
    const highIdx = out.indexOf("high = ");
    const mrIdx = out.indexOf("manual-review = ");
    expect(critIdx).toBeLessThan(highIdx);
    expect(highIdx).toBeLessThan(mrIdx);
  });

  it("NEGATIVE critical legend: omitted when zero critical findings", () => {
    const result: ScanResult = {
      findings: [{ ...baseFinding, severity: "high", state: "not-verified" }],
      inventory: [],
      metadata: META,
    };
    const out = renderSummary(result, { useAnsi: false, durationMs: 1000 });
    expect(out).not.toContain("critical = ");
  });

  it("NEGATIVE info legend: omitted when zero info findings", () => {
    const result: ScanResult = {
      findings: [{ ...baseFinding, severity: "critical", state: "not-verified" }],
      inventory: [],
      metadata: META,
    };
    const out = renderSummary(result, { useAnsi: false, durationMs: 1000 });
    expect(out).not.toContain("info = ");
  });

  it("NEGATIVE all legends: omitted on a clean scan (no findings, no noise)", () => {
    const result: ScanResult = { findings: [], inventory: [], metadata: META };
    const out = renderSummary(result, { useAnsi: false, durationMs: 1000 });
    expect(out).not.toContain("critical = ");
    expect(out).not.toContain("high = ");
    expect(out).not.toContain("medium = ");
    expect(out).not.toContain("info = ");
    expect(out).not.toContain("manual-review = ");
  });
});

// Parse-error display contract — engine/parse-error is engine telemetry, not
// a webhook-verification finding. It must not count toward the severity tally
// (orange `! high` glyph would contradict the "high = exploitable verification
// weakness" legend) and must not count toward the manual-review tally (there's
// no handler to review). The cal.com / n8n public-scan output regressed before
// this contract — see bugs-in-the-wild.md.
describe("renderSummary — engine/parse-error exclusion + footer line", () => {
  const parseErrorFinding: Finding = {
    ...baseFinding,
    id: "pe1",
    rule_id: "engine/parse-error",
    provider: "unknown",
    severity: "high",
    state: "manual-review",
    file_path: "src/broken.ts",
    primary_location_line_hash: "pe1",
  };

  it("engine/parse-error finding does NOT increment sevCounts.high", () => {
    const result: ScanResult = {
      findings: [parseErrorFinding],
      inventory: [],
      metadata: META,
    };
    const out = renderSummary(result, { useAnsi: false, durationMs: 1000 });
    // The contradictory "1 high" headline (with no rule finding behind it) is
    // exactly what made the cal.com / n8n public scans look broken. With zero
    // rule findings the entire severity tally line drops out — handlers-only
    // headline is the clean shape.
    expect(out).not.toContain("1 high");
    expect(out).not.toContain("1 manual-review");
    // And the "high = exploitable verification weakness" legend must not render
    // because there are no rule findings at high severity — only engine telemetry.
    expect(out).not.toContain("high = exploitable verification weakness");
  });

  it("engine/parse-error finding does NOT increment manualReviewCount", () => {
    const result: ScanResult = {
      findings: [parseErrorFinding],
      inventory: [],
      metadata: META,
    };
    const out = renderSummary(result, { useAnsi: false, durationMs: 1000 });
    // 0 manual-review surfaces the all-zeros line, which the summary drops
    // entirely when no rule findings exist — so headline = handlers-only.
    expect(out).not.toContain("manual-review");
  });

  it("appends '(N files could not be parsed — counts toward --fail-on high)' when parse-error finding present", () => {
    const result: ScanResult = {
      findings: [parseErrorFinding],
      inventory: [],
      metadata: META,
    };
    const out = renderSummary(result, { useAnsi: false, durationMs: 1000 });
    expect(out).toContain("(1 file could not be parsed");
    expect(out).toContain("counts toward --fail-on high");
  });

  it("singularizes / pluralizes the parse-error footer", () => {
    const result: ScanResult = {
      findings: [
        parseErrorFinding,
        { ...parseErrorFinding, id: "pe2", primary_location_line_hash: "pe2", file_path: "b.ts" },
      ],
      inventory: [],
      metadata: META,
    };
    const out = renderSummary(result, { useAnsi: false, durationMs: 1000 });
    expect(out).toContain("(2 files could not be parsed");
    expect(out).not.toContain("(2 file could not be parsed");
  });

  it("NEGATIVE: no parse-error footer when zero engine/parse-error findings", () => {
    const result: ScanResult = {
      findings: [{ ...baseFinding, severity: "critical", state: "not-verified" }],
      inventory: [],
      metadata: META,
    };
    const out = renderSummary(result, { useAnsi: false, durationMs: 1000 });
    expect(out).not.toContain("could not be parsed");
  });

  it("rule findings + parse-error mix: rule findings drive sevCounts, parse-error drives footer only", () => {
    const result: ScanResult = {
      findings: [
        { ...baseFinding, id: "f1", severity: "critical", state: "not-verified" },
        parseErrorFinding,
      ],
      inventory: [],
      metadata: META,
    };
    const out = renderSummary(result, { useAnsi: false, durationMs: 1000 });
    expect(out).toContain("1 critical");
    // parse-error (severity high) is routed to the footer line, NOT the severity tally — so no
    // high segment appears (and zero tiers are trimmed). It would read "1 high" if miscounted.
    expect(out).not.toContain("1 high");
    expect(out).toContain("(1 file could not be parsed");
  });
});
