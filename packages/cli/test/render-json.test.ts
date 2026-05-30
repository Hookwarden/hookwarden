import type {
  Finding,
  ScanMetadata,
  ScanResult,
  Severity,
  SuppressedPayload,
  Verdict,
  WebhookHandler,
} from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { renderJson } from "../src/render/json.js";
import type { StaleSuppression } from "../src/suppress/stale.js";

const FROZEN_SCANNED_AT = "2026-05-03T12:00:00.000Z";

function makeMeta(overrides: Partial<ScanMetadata> = {}): ScanMetadata {
  return {
    engine_version: "0.4.0",
    engine_commit_sha: "abc1234",
    rule_pack_version: "0.4.0",
    rule_pack_content_hash: "sha256:deadbeef",
    scanned_at: FROZEN_SCANNED_AT,
    parse_errors_count: 0,
    parsed_files_count: 10,
    total_files_count: 10,
    parse_candidates_count: 10,
    ...overrides,
  };
}

function makeFinding(
  overrides: Partial<Finding> & {
    severity?: Severity;
    state?: Verdict;
    suppressed?: SuppressedPayload | null;
  } = {},
): Finding {
  const severity: Severity = overrides.severity ?? "high";
  const state: Verdict = overrides.state ?? "verified";
  const ruleId = overrides.rule_id ?? "stripe/missing-verification";
  const filePath = overrides.file_path ?? "src/webhook.ts";
  const line = overrides.location?.line ?? 10;
  return {
    id: overrides.id ?? `id-${ruleId}-${line}`,
    rule_id: ruleId,
    provider: overrides.provider ?? "stripe",
    severity,
    state,
    file_path: filePath,
    location: overrides.location ?? { line, col: 1, end_line: line, end_col: 10 },
    snippet: overrides.snippet ?? "<redacted-snippet>",
    handler_id: overrides.handler_id ?? null,
    primary_location_line_hash: overrides.primary_location_line_hash ?? `hash-${ruleId}-${line}`,
    message: overrides.message ?? "missing verification",
    metadata: overrides.metadata ?? {},
    ...(overrides.suppressed !== undefined ? { suppressed: overrides.suppressed } : {}),
  };
}

function makeResult(
  findings: Finding[],
  inventory: WebhookHandler[] = [],
  metaOverrides: Partial<ScanMetadata> = {},
): ScanResult {
  return { findings, inventory, metadata: makeMeta(metaOverrides) };
}

describe("renderJson — D-59 envelope", () => {
  it("emits the envelope with empty arrays + zero counts when no findings", () => {
    const out = renderJson({
      scanResult: makeResult([]),
      ruleSet: null,
      stale: [],
    });
    const parsed = JSON.parse(out);
    expect(parsed.schema_version).toBe("1.0");
    expect(parsed.scan.findings).toEqual([]);
    expect(parsed.scan.inventory).toEqual([]);
    expect(parsed.scan.counts.active).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    });
    expect(parsed.scan.counts.suppressed).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    });
    expect(parsed.suppressions.applied).toEqual([]);
    expect(parsed.suppressions.stale).toEqual([]);
  });

  it("preserves severity AND state as siblings on each Finding (D-29)", () => {
    const out = renderJson({
      scanResult: makeResult([makeFinding({ severity: "critical", state: "not-verified" })]),
      ruleSet: null,
      stale: [],
    });
    const parsed = JSON.parse(out);
    expect(parsed.scan.findings).toHaveLength(1);
    const f = parsed.scan.findings[0];
    expect(f.severity).toBe("critical");
    expect(f.state).toBe("not-verified");
    expect(f.rule_id).toBe("stripe/missing-verification");
  });

  it("inline-suppressed finding stays in findings[]; counts split (D-63); applied[] indexes it", () => {
    const out = renderJson({
      scanResult: makeResult([
        makeFinding({ severity: "high", suppressed: { source: "inline", comment: "ok" } }),
      ]),
      ruleSet: null,
      stale: [],
    });
    const parsed = JSON.parse(out);
    expect(parsed.scan.findings).toHaveLength(1);
    expect(parsed.scan.findings[0].suppressed.source).toBe("inline");
    expect(parsed.scan.counts.active.high).toBe(0);
    expect(parsed.scan.counts.suppressed.high).toBe(1);
    expect(parsed.suppressions.applied).toHaveLength(1);
    expect(parsed.suppressions.applied[0].source).toBe("inline");
  });

  it("ignore-suppressed finding carries suppressed.pattern", () => {
    const out = renderJson({
      scanResult: makeResult([
        makeFinding({
          severity: "medium",
          suppressed: { source: "ignore", pattern: "src/legacy/*.ts" },
        }),
      ]),
      ruleSet: null,
      stale: [],
    });
    const parsed = JSON.parse(out);
    expect(parsed.scan.findings[0].suppressed.source).toBe("ignore");
    expect(parsed.scan.findings[0].suppressed.pattern).toBe("src/legacy/*.ts");
    expect(parsed.scan.counts.active.medium).toBe(0);
    expect(parsed.scan.counts.suppressed.medium).toBe(1);
  });

  it("baseline-suppressed finding carries suppressed.baselined_at", () => {
    const out = renderJson({
      scanResult: makeResult([
        makeFinding({
          severity: "low",
          suppressed: {
            source: "baseline",
            baselined_at: "2026-05-01T00:00:00.000Z",
          },
        }),
      ]),
      ruleSet: null,
      stale: [],
    });
    const parsed = JSON.parse(out);
    expect(parsed.scan.findings[0].suppressed.source).toBe("baseline");
    expect(parsed.scan.findings[0].suppressed.baselined_at).toBe("2026-05-01T00:00:00.000Z");
    expect(parsed.scan.counts.active.low).toBe(0);
    expect(parsed.scan.counts.suppressed.low).toBe(1);
  });

  it("parse-error findings appear in findings[] AND parse_errors_count reflects them", () => {
    const parseError = makeFinding({
      rule_id: "engine/parse-error",
      severity: "high",
      message: "syntax error at line 5",
    });
    const out = renderJson({
      scanResult: makeResult([parseError], [], { parse_errors_count: 1 }),
      ruleSet: null,
      stale: [],
    });
    const parsed = JSON.parse(out);
    expect(parsed.scan.findings).toHaveLength(1);
    expect(parsed.scan.findings[0].rule_id).toBe("engine/parse-error");
    expect(parsed.scan.parse_errors_count).toBe(1);
  });

  it("counts.active correctly tabulates mixed-severity findings", () => {
    const out = renderJson({
      scanResult: makeResult([
        makeFinding({ severity: "critical", primary_location_line_hash: "h1" }),
        makeFinding({ severity: "high", primary_location_line_hash: "h2" }),
        makeFinding({ severity: "high", primary_location_line_hash: "h3" }),
        makeFinding({ severity: "medium", primary_location_line_hash: "h4" }),
      ]),
      ruleSet: null,
      stale: [],
    });
    const parsed = JSON.parse(out);
    expect(parsed.scan.counts.active.critical).toBe(1);
    expect(parsed.scan.counts.active.high).toBe(2);
    expect(parsed.scan.counts.active.medium).toBe(1);
    expect(parsed.scan.counts.active.low).toBe(0);
    expect(parsed.scan.counts.active.info).toBe(0);
  });

  it("findings[] sorted by (severity_rank, file_path, line, col, rule_id)", () => {
    const findings = [
      makeFinding({
        severity: "low",
        file_path: "src/z.ts",
        location: { line: 1, col: 1, end_line: 1, end_col: 5 },
        primary_location_line_hash: "h-low-z",
      }),
      makeFinding({
        severity: "critical",
        file_path: "src/b.ts",
        location: { line: 5, col: 1, end_line: 5, end_col: 5 },
        primary_location_line_hash: "h-crit-b",
      }),
      makeFinding({
        severity: "critical",
        file_path: "src/a.ts",
        location: { line: 10, col: 1, end_line: 10, end_col: 5 },
        primary_location_line_hash: "h-crit-a",
      }),
      makeFinding({
        severity: "high",
        file_path: "src/m.ts",
        location: { line: 1, col: 1, end_line: 1, end_col: 5 },
        primary_location_line_hash: "h-high-m",
      }),
    ];
    const out = renderJson({ scanResult: makeResult(findings), ruleSet: null, stale: [] });
    const parsed = JSON.parse(out);
    const order = parsed.scan.findings.map(
      (f: { severity: Severity; file_path: string }) => `${f.severity}|${f.file_path}`,
    );
    expect(order).toEqual([
      "critical|src/a.ts",
      "critical|src/b.ts",
      "high|src/m.ts",
      "low|src/z.ts",
    ]);
  });

  it("suppressions.stale[] populated when stale entries exist (D-67)", () => {
    const stale: StaleSuppression[] = [
      { source: "inline", rule_id: "stripe/foo", file_path: "src/x.ts", line: 5 },
      { source: "ignore", pattern: "old/*.ts" },
      { source: "baseline", rule_id: "stripe/bar" },
    ];
    const out = renderJson({ scanResult: makeResult([]), ruleSet: null, stale });
    const parsed = JSON.parse(out);
    expect(parsed.suppressions.stale).toHaveLength(3);
    expect(parsed.suppressions.stale[0].source).toBe("inline");
    expect(parsed.suppressions.stale[1].pattern).toBe("old/*.ts");
  });

  it("output is byte-stable across two consecutive renders with identical inputs", () => {
    const findings = [
      makeFinding({ severity: "critical", primary_location_line_hash: "h1" }),
      makeFinding({ severity: "high", primary_location_line_hash: "h2" }),
    ];
    const inputs = { scanResult: makeResult(findings), ruleSet: null, stale: [] };
    const out1 = renderJson(inputs);
    const out2 = renderJson(inputs);
    expect(out1).toBe(out2);
  });

  it("output is valid JSON (JSON.parse succeeds)", () => {
    const out = renderJson({
      scanResult: makeResult([makeFinding()]),
      ruleSet: null,
      stale: [],
    });
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it("envelope has schema_version: '1.0' (D-59)", () => {
    const out = renderJson({ scanResult: makeResult([]), ruleSet: null, stale: [] });
    expect(out).toContain('"schema_version": "1.0"');
    const parsed = JSON.parse(out);
    expect(parsed.schema_version).toBe("1.0");
  });

  // v0.7.1 references emission — JSON envelope surfaces external citations
  // from rule.references on each finding so consumers (CI, dashboards, audit
  // exports) can render them without re-loading the rule pack.
  describe("v0.7.1 references field", () => {
    const ruleSetWithRefs = {
      schema_version: 1,
      rule_pack_version: "0.7.1",
      providers: {},
      predicates: {},
      rules: [
        {
          rule_id: "stripe/missing-verification",
          provider: "stripe",
          severity: "critical" as Severity,
          emits_state: "not-verified" as Verdict,
          message: "test",
          matcher: null,
          predicate_name: "stripe-missing",
          applies_to: "all" as const,
          provider_docs_url: "https://stripe.com/docs/webhooks",
          path_severity_overrides: null,
          fix: null,
          references: [
            "https://www.svix.com/blog/common-failure-modes-for-webhook-signatures/",
            "CWE-345",
          ],
        },
      ],
    };

    it("emits references[] populated from the rule pack", () => {
      const findings = [
        makeFinding({ rule_id: "stripe/missing-verification", primary_location_line_hash: "h1" }),
      ];
      const out = renderJson({ scanResult: makeResult(findings), ruleSet: ruleSetWithRefs, stale: [] });
      const parsed = JSON.parse(out);
      expect(parsed.scan.findings[0].references).toEqual([
        "https://www.svix.com/blog/common-failure-modes-for-webhook-signatures/",
        "CWE-345",
      ]);
    });

    it("emits empty references[] (not omitted) when ruleSet is null — consumers can length-check", () => {
      const findings = [makeFinding({ primary_location_line_hash: "h1" })];
      const out = renderJson({ scanResult: makeResult(findings), ruleSet: null, stale: [] });
      const parsed = JSON.parse(out);
      expect(parsed.scan.findings[0].references).toEqual([]);
    });
  });

  it("snapshot — canonical mixed scan with active + suppressed findings", () => {
    const findings = [
      makeFinding({
        severity: "critical",
        file_path: "src/stripe.ts",
        location: { line: 10, col: 5, end_line: 10, end_col: 30 },
        primary_location_line_hash: "h1",
      }),
      makeFinding({
        severity: "high",
        rule_id: "github/missing-secret",
        provider: "github",
        file_path: "src/gh.ts",
        location: { line: 20, col: 1, end_line: 20, end_col: 25 },
        primary_location_line_hash: "h2",
        suppressed: { source: "inline", comment: "intentional for demo" },
      }),
    ];
    const out = renderJson({ scanResult: makeResult(findings), ruleSet: null, stale: [] });
    expect(out).toMatchSnapshot();
  });
});
