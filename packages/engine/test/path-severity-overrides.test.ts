import { describe, expect, it } from "vitest";
import { applyPathSeverityOverrides } from "../src/evaluator/path-severity-overrides.js";
import type { Finding } from "../src/types/finding.js";
import type { RuleDefinition } from "../src/types/rule-set.js";

const baseFinding: Finding = {
  id: "fid",
  rule_id: "stripe/hardcoded-secret-prefix",
  provider: "stripe",
  severity: "critical",
  state: "not-verified",
  file_path: "src/foo.ts",
  location: { line: 1, col: 1, end_line: 1, end_col: 2 },
  snippet: "<STRING:N>",
  handler_id: null,
  primary_location_line_hash: "h",
  message: "m",
  metadata: {},
};

const baseRule: RuleDefinition = {
  rule_id: "stripe/hardcoded-secret-prefix",
  provider: "stripe",
  severity: "critical",
  emits_state: "not-verified",
  message: "m",
  matcher: null,
  predicate_name: "stripe-hardcoded-secret-prefix",
  applies_to: "all",
  provider_docs_url: "https://stripe.com/docs/webhooks",
  path_severity_overrides: null,
};

describe("applyPathSeverityOverrides (D-57 RULES-05)", () => {
  it("returns finding unchanged when path_severity_overrides is null", () => {
    expect(applyPathSeverityOverrides(baseFinding, baseRule)).toBe(baseFinding);
  });

  it("returns finding unchanged when no override pattern matches", () => {
    const rule: RuleDefinition = {
      ...baseRule,
      path_severity_overrides: [{ patterns: ["**/__tests__/**"], severity: "info" }],
    };
    expect(applyPathSeverityOverrides(baseFinding, rule)).toBe(baseFinding);
  });

  it("rewrites severity to info when **/__tests__/** matches", () => {
    const rule: RuleDefinition = {
      ...baseRule,
      path_severity_overrides: [{ patterns: ["**/__tests__/**"], severity: "info" }],
    };
    const f: Finding = { ...baseFinding, file_path: "src/__tests__/seed.ts" };
    expect(applyPathSeverityOverrides(f, rule).severity).toBe("info");
  });

  it("matches **/*.test.{js,ts,py} brace expansion", () => {
    const rule: RuleDefinition = {
      ...baseRule,
      path_severity_overrides: [
        { patterns: ["**/*.test.{js,ts,py}"], severity: "info" },
      ],
    };
    const f: Finding = { ...baseFinding, file_path: "src/foo.test.ts" };
    expect(applyPathSeverityOverrides(f, rule).severity).toBe("info");
  });

  it("preserves Finding.state — only severity is rewritten", () => {
    const rule: RuleDefinition = {
      ...baseRule,
      path_severity_overrides: [{ patterns: ["**/fixtures/**"], severity: "info" }],
    };
    const f: Finding = { ...baseFinding, file_path: "fixtures/secret.ts" };
    const out = applyPathSeverityOverrides(f, rule);
    expect(out.severity).toBe("info");
    expect(out.state).toBe("not-verified");
  });

  it("first matching override wins (no second-match application)", () => {
    const rule: RuleDefinition = {
      ...baseRule,
      path_severity_overrides: [
        { patterns: ["**/fixtures/**"], severity: "low" },
        { patterns: ["**/fixtures/**"], severity: "info" },
      ],
    };
    const f: Finding = { ...baseFinding, file_path: "fixtures/x.ts" };
    expect(applyPathSeverityOverrides(f, rule).severity).toBe("low");
  });

  it("identity when severity already equals the override target", () => {
    const rule: RuleDefinition = {
      ...baseRule,
      path_severity_overrides: [{ patterns: ["**/__tests__/**"], severity: "critical" }],
    };
    const f: Finding = { ...baseFinding, file_path: "__tests__/x.ts", severity: "critical" };
    expect(applyPathSeverityOverrides(f, rule)).toBe(f);
  });
});
