// Phase 25 COMPLIANCE-01 (D-03 / OQ#4) — compliance-coverage tally + ratchet gate.
//
// Proves: (1) the tally counts non-empty mappings per framework over the FULL
// denominator (low-signal unmapped rules ARE counted in total_rules); (2) the
// `--version --verbose` stat line shape; (3) the SYNTHETIC REGRESSION — when a
// mapping is removed, findCoverageRegressions flags the framework, which is what
// the CI release gate blocks on. The negative test IS the auditor-facing evidence
// that the coverage stat cannot silently regress ([[feedback_negative_tests_required]]).

import { describe, expect, it } from "vitest";
import baseline from "../compliance-coverage-baseline.json" with { type: "json" };
import {
  ALL_PREDICATES,
  BUNDLED_RULE_DOCUMENTS,
  computeComplianceCoverage,
  countRulesWithAnyMapping,
  findCoverageRegressions,
  formatComplianceCoverageLine,
  loadRuleSet,
  PROVIDER_CATALOG,
} from "../src/index.js";

async function loadBundledRuleSet() {
  return loadRuleSet({
    rule_documents: BUNDLED_RULE_DOCUMENTS.map((e) => e.doc),
    predicates: ALL_PREDICATES,
    providers: PROVIDER_CATALOG,
    rule_pack_version: "0.0.0-test",
  });
}

describe("compliance-coverage tally", () => {
  it("counts non-empty mappings per framework over the full denominator", async () => {
    const rs = await loadBundledRuleSet();
    const cov = computeComplianceCoverage(rs);
    // total_rules is the FULL denominator — every shipped rule, mapped or not.
    expect(cov.total_rules).toBe(rs.rules.length);
    // Some rules are deliberately unmapped (low-signal) → mapped < total (honest stat, D-03).
    const anyMapped = countRulesWithAnyMapping(rs);
    expect(anyMapped).toBeGreaterThan(0);
    expect(anyMapped).toBeLessThan(cov.total_rules);
    // Each per-framework count is bounded by total_rules.
    for (const fw of ["soc2_cc", "iso27001", "eu_ai_act_annex_iii", "nist_ai_rmf"] as const) {
      expect(cov[fw]).toBeGreaterThan(0);
      expect(cov[fw]).toBeLessThanOrEqual(cov.total_rules);
    }
  });

  it("current coverage matches the checked-in baseline counts (ratchet stays in sync)", async () => {
    const rs = await loadBundledRuleSet();
    const cov = computeComplianceCoverage(rs);
    expect(cov.soc2_cc).toBe(baseline.soc2_cc);
    expect(cov.iso27001).toBe(baseline.iso27001);
    expect(cov.eu_ai_act_annex_iii).toBe(baseline.eu_ai_act_annex_iii);
    expect(cov.nist_ai_rmf).toBe(baseline.nist_ai_rmf);
    expect(cov.total_rules).toBe(baseline.total_rules);
  });

  it("renders the --version --verbose stat line in the auditor-facing shape", async () => {
    const rs = await loadBundledRuleSet();
    const cov = computeComplianceCoverage(rs);
    const line = formatComplianceCoverageLine(cov, countRulesWithAnyMapping(rs));
    expect(line).toMatch(
      /^\d+ of \d+ rules carry compliance_mappings: SOC2 \d+, ISO27001 \d+, EU AI Act Annex III \d+, NIST AI RMF \d+$/,
    );
  });

  it("at baseline reports NO regression (CI gate is green)", async () => {
    const rs = await loadBundledRuleSet();
    const cov = computeComplianceCoverage(rs);
    expect(findCoverageRegressions(cov, baseline)).toEqual([]);
  });

  // SYNTHETIC REGRESSION — the negative test that proves the CI gate blocks a
  // silent coverage drop. Removing one rule's mapping must produce a regression
  // for every framework that rule contributed to.
  it("blocks a synthetic regression when a mapping is removed (RED proof)", async () => {
    const rs = await loadBundledRuleSet();
    // Drop the compliance_mappings of the first mapped rule.
    const firstMappedIdx = rs.rules.findIndex((r) => r.compliance_mappings !== null);
    expect(firstMappedIdx).toBeGreaterThanOrEqual(0);
    const tampered = {
      rules: rs.rules.map((r, i) =>
        i === firstMappedIdx ? { ...r, compliance_mappings: null } : r,
      ),
    };
    const cov = computeComplianceCoverage(tampered);
    const regressions = findCoverageRegressions(cov, baseline);
    expect(regressions.length).toBeGreaterThan(0);
  });
});
