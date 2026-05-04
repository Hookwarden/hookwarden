import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Finding,
  ProviderCatalog,
  RuleDefinition,
  RuleSet,
  ScanMetadata,
  ScanResult,
  Severity,
  SuppressedPayload,
  Verdict,
  WebhookHandler,
} from "@hookwarden/engine";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import {
  renderSarif,
  SARIF_LEVEL_BY_SEVERITY,
} from "../src/render/sarif.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, "fixtures/sarif-2.1.0-schema.json");

const FROZEN_SCANNED_AT = "2026-05-03T12:00:00.000Z";

function makeMeta(overrides: Partial<ScanMetadata> = {}): ScanMetadata {
  return {
    engine_version: "0.4.0",
    engine_commit_sha: "abc1234",
    rule_pack_version: "0.4.0",
    rule_pack_content_hash: "deadbeef",
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

function makeRule(overrides: Partial<RuleDefinition> = {}): RuleDefinition {
  return {
    rule_id: overrides.rule_id ?? "stripe/missing-verification",
    provider: overrides.provider ?? "stripe",
    severity: overrides.severity ?? "critical",
    emits_state: overrides.emits_state ?? "not-verified",
    message: overrides.message ?? "missing verification",
    matcher: overrides.matcher ?? null,
    predicate_name: overrides.predicate_name ?? "verifies-stripe-signature",
    applies_to: overrides.applies_to ?? "all",
    provider_docs_url: overrides.provider_docs_url ?? "https://stripe.com/docs/webhooks",
    path_severity_overrides: overrides.path_severity_overrides ?? null,
  };
}

function makeRuleSet(rules: RuleDefinition[]): RuleSet {
  const providers: ProviderCatalog = { stripe: { documentation_url: "https://stripe.com/docs" } };
  return {
    schema_version: 1,
    rule_pack_version: "0.4.0",
    providers,
    rules,
    predicates: {},
  };
}

describe("renderSarif", () => {
  it("emits SARIF with empty results when no findings; tool.driver.rules populated from RuleSet", () => {
    const ruleSet = makeRuleSet([makeRule(), makeRule({ rule_id: "github/missing-secret", provider: "github", severity: "high" })]);
    const out = renderSarif({ scanResult: makeResult([]), ruleSet, stale: [] });
    const parsed = JSON.parse(out);
    expect(parsed.runs[0].results).toEqual([]);
    expect(parsed.runs[0].tool.driver.rules).toHaveLength(2);
  });

  it("critical finding → level 'error' (D-60); state preserved (D-29); fingerprint carried (D-76)", () => {
    const f = makeFinding({ severity: "critical", state: "not-verified" });
    const out = renderSarif({ scanResult: makeResult([f]), ruleSet: null, stale: [] });
    const parsed = JSON.parse(out);
    const result = parsed.runs[0].results[0];
    expect(result.level).toBe("error");
    expect(result.properties["hookwarden-state"]).toBe("not-verified");
    expect(result.partialFingerprints.primaryLocationLineHash).toBe(f.primary_location_line_hash);
  });

  it("high finding → level 'error' (D-60)", () => {
    const out = renderSarif({
      scanResult: makeResult([makeFinding({ severity: "high" })]),
      ruleSet: null,
      stale: [],
    });
    expect(JSON.parse(out).runs[0].results[0].level).toBe("error");
  });

  it("medium finding → level 'warning' (D-60)", () => {
    const out = renderSarif({
      scanResult: makeResult([makeFinding({ severity: "medium" })]),
      ruleSet: null,
      stale: [],
    });
    expect(JSON.parse(out).runs[0].results[0].level).toBe("warning");
  });

  it("low finding → level 'note' (D-60)", () => {
    const out = renderSarif({
      scanResult: makeResult([makeFinding({ severity: "low" })]),
      ruleSet: null,
      stale: [],
    });
    expect(JSON.parse(out).runs[0].results[0].level).toBe("note");
  });

  it("info finding → level 'note' (D-60)", () => {
    const out = renderSarif({
      scanResult: makeResult([makeFinding({ severity: "info" })]),
      ruleSet: null,
      stale: [],
    });
    expect(JSON.parse(out).runs[0].results[0].level).toBe("note");
  });

  it("inline-suppressed finding → suppressions[0].kind === 'inSource' with rule_id in justification", () => {
    const f = makeFinding({
      severity: "high",
      suppressed: { source: "inline", comment: "intentional for demo" },
    });
    const out = renderSarif({ scanResult: makeResult([f]), ruleSet: null, stale: [] });
    const result = JSON.parse(out).runs[0].results[0];
    expect(result.suppressions).toHaveLength(1);
    expect(result.suppressions[0].kind).toBe("inSource");
    expect(result.suppressions[0].justification).toContain("source=inline");
    expect(result.suppressions[0].justification).toContain("comment=intentional for demo");
    expect(result.level).toBe("error"); // level still emitted normally
    expect(result.properties["hookwarden-state"]).toBe("verified");
  });

  it("ignore-suppressed finding → suppressions[0].kind === 'external' with pattern in justification", () => {
    const f = makeFinding({
      severity: "medium",
      suppressed: { source: "ignore", pattern: "src/legacy/*.ts" },
    });
    const out = renderSarif({ scanResult: makeResult([f]), ruleSet: null, stale: [] });
    const result = JSON.parse(out).runs[0].results[0];
    expect(result.suppressions[0].kind).toBe("external");
    expect(result.suppressions[0].justification).toContain("pattern=src/legacy/*.ts");
  });

  it("baseline-suppressed finding → suppressions[0].kind === 'external' with baselined_at in justification", () => {
    const f = makeFinding({
      severity: "low",
      suppressed: { source: "baseline", baselined_at: "2026-05-01T00:00:00.000Z" },
    });
    const out = renderSarif({ scanResult: makeResult([f]), ruleSet: null, stale: [] });
    const result = JSON.parse(out).runs[0].results[0];
    expect(result.suppressions[0].kind).toBe("external");
    expect(result.suppressions[0].justification).toContain("baseline=2026-05-01T00:00:00.000Z");
  });

  it("results sorted by (severity_rank, file_path, line, col, rule_id)", () => {
    const findings = [
      makeFinding({ severity: "low", file_path: "src/z.ts", primary_location_line_hash: "h-low-z" }),
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
      makeFinding({ severity: "high", file_path: "src/m.ts", primary_location_line_hash: "h-high-m" }),
      makeFinding({ severity: "medium", file_path: "src/n.ts", primary_location_line_hash: "h-med-n" }),
    ];
    const out = renderSarif({ scanResult: makeResult(findings), ruleSet: null, stale: [] });
    const results = JSON.parse(out).runs[0].results;
    const order = results.map((r: { level: string; locations: Array<{ physicalLocation: { artifactLocation: { uri: string } } }> }) =>
      `${r.level}|${r.locations[0].physicalLocation.artifactLocation.uri}`,
    );
    expect(order).toEqual([
      "error|src/a.ts",   // critical
      "error|src/b.ts",   // critical
      "error|src/m.ts",   // high
      "warning|src/n.ts", // medium
      "note|src/z.ts",    // low
    ]);
  });

  it("output passes OASIS 2.1.0 schema validation", async () => {
    const schemaText = await fs.readFile(SCHEMA_PATH, "utf-8");
    const schema = JSON.parse(schemaText);

    // The OASIS schema contains a known-malformed BCP-47 pattern
    // (`/^[a-zA-Z]{2}|^[a-zA-Z]{2}-[a-zA-Z]{2}]?$/` — note the stray `]`) that
    // Ajv refuses to compile. Strip every uncompilable `pattern` keyword so
    // structural validation still runs against the rest of the schema.
    const stripBadPatterns = (node: unknown): void => {
      if (node === null || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const item of node) stripBadPatterns(item);
        return;
      }
      const obj = node as Record<string, unknown>;
      if (typeof obj.pattern === "string") {
        // Ajv compiles patterns with the `u` flag; check unicode-mode validity.
        try {
          new RegExp(obj.pattern, "u");
        } catch {
          delete obj.pattern;
        }
      }
      for (const v of Object.values(obj)) stripBadPatterns(v);
    };
    stripBadPatterns(schema);

    const ajv = new Ajv({ strict: false, allErrors: true });
    const validate = ajv.compile(schema);

    const ruleSet = makeRuleSet([
      makeRule(),
      makeRule({ rule_id: "github/missing-secret", provider: "github", severity: "high" }),
    ]);
    const findings = [
      makeFinding({ severity: "critical", primary_location_line_hash: "h1" }),
      makeFinding({
        severity: "high",
        rule_id: "github/missing-secret",
        provider: "github",
        primary_location_line_hash: "h2",
      }),
      makeFinding({
        severity: "medium",
        primary_location_line_hash: "h3",
        suppressed: { source: "inline", comment: "ok" },
      }),
    ];

    const out = renderSarif({ scanResult: makeResult(findings), ruleSet, stale: [] });
    const parsed = JSON.parse(out);
    const valid = validate(parsed);
    if (!valid) {
      // biome-ignore lint/suspicious/noConsole: surfacing schema errors makes the failure debuggable
      console.error(JSON.stringify(validate.errors, null, 2));
    }
    expect(valid).toBe(true);
  });

  it("output is byte-stable across two consecutive renders with identical inputs", () => {
    const ruleSet = makeRuleSet([makeRule()]);
    const findings = [
      makeFinding({ severity: "critical", primary_location_line_hash: "h1" }),
      makeFinding({ severity: "high", primary_location_line_hash: "h2" }),
    ];
    const inputs = { scanResult: makeResult(findings), ruleSet, stale: [] };
    const out1 = renderSarif(inputs);
    const out2 = renderSarif(inputs);
    expect(out1).toBe(out2);
  });

  it("tool.driver.rules[].length === ruleSet.rules.length; defaultConfiguration.level matches D-60", () => {
    const rules = [
      makeRule({ rule_id: "stripe/x", severity: "critical" }),
      makeRule({ rule_id: "stripe/y", severity: "high" }),
      makeRule({ rule_id: "stripe/z", severity: "medium" }),
      makeRule({ rule_id: "stripe/w", severity: "low" }),
      makeRule({ rule_id: "stripe/v", severity: "info" }),
    ];
    const ruleSet = makeRuleSet(rules);
    const out = renderSarif({ scanResult: makeResult([]), ruleSet, stale: [] });
    const driverRules = JSON.parse(out).runs[0].tool.driver.rules;
    expect(driverRules).toHaveLength(5);
    for (const dr of driverRules) {
      const sourceRule = rules.find((r) => r.rule_id === dr.id);
      expect(dr.defaultConfiguration.level).toBe(SARIF_LEVEL_BY_SEVERITY[sourceRule!.severity]);
    }
  });

  it("parse-error finding (rule_id engine/parse-error, manual-review state) emits level=error", () => {
    const f = makeFinding({
      rule_id: "engine/parse-error",
      severity: "high",
      state: "manual-review",
      message: "syntax error at line 5",
    });
    const out = renderSarif({ scanResult: makeResult([f]), ruleSet: null, stale: [] });
    const result = JSON.parse(out).runs[0].results[0];
    expect(result.level).toBe("error");
    expect(result.properties["hookwarden-state"]).toBe("manual-review");
  });

  it("every result has artifactLocation.uriBaseId === '%SRCROOT%'", () => {
    const findings = [
      makeFinding({ primary_location_line_hash: "h1" }),
      makeFinding({ severity: "low", file_path: "src/other.ts", primary_location_line_hash: "h2" }),
    ];
    const out = renderSarif({ scanResult: makeResult(findings), ruleSet: null, stale: [] });
    const results = JSON.parse(out).runs[0].results;
    for (const r of results) {
      expect(r.locations[0].physicalLocation.artifactLocation.uriBaseId).toBe("%SRCROOT%");
    }
  });

  it("tool.driver: name='hookwarden', version=engine_version, informationUri set", () => {
    const out = renderSarif({
      scanResult: makeResult([], [], { engine_version: "1.2.3" }),
      ruleSet: null,
      stale: [],
    });
    const driver = JSON.parse(out).runs[0].tool.driver;
    expect(driver.name).toBe("hookwarden");
    expect(driver.version).toBe("1.2.3");
    expect(driver.semanticVersion).toBe("1.2.3");
    expect(driver.informationUri).toBe("https://hookwarden.dev");
  });

  it("snapshot — canonical mixed scan with active + suppressed findings", () => {
    const ruleSet = makeRuleSet([
      makeRule(),
      makeRule({ rule_id: "github/missing-secret", provider: "github", severity: "high" }),
    ]);
    const findings = [
      makeFinding({
        severity: "critical",
        primary_location_line_hash: "h1",
        file_path: "src/stripe.ts",
        location: { line: 10, col: 5, end_line: 10, end_col: 30 },
      }),
      makeFinding({
        severity: "high",
        rule_id: "github/missing-secret",
        provider: "github",
        primary_location_line_hash: "h2",
        file_path: "src/gh.ts",
        location: { line: 20, col: 1, end_line: 20, end_col: 25 },
        suppressed: { source: "inline", comment: "intentional" },
      }),
    ];
    const out = renderSarif({ scanResult: makeResult(findings), ruleSet, stale: [] });
    expect(out).toMatchSnapshot();
  });
});
