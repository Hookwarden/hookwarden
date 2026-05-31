// Phase 25 COMPLIANCE-01 (D-03 / OQ#4): compliance-coverage tally.
//
// Pure function over the loaded RuleSet. For each compliance framework it
// counts the number of rules that carry a NON-EMPTY mapping for that framework,
// and reports `total_rules` = ALL shipped rules (the full denominator). Keeping
// low-signal / cosmetic rules in the denominator (unmapped) is deliberate — it
// keeps the `hookwarden --version --verbose` coverage stat honest rather than
// inflating the ratio by mapping everything (D-03).
//
// Consumed by:
//   - `hookwarden --version --verbose` (the auditor-facing coverage stat)
//   - the CI coverage-regression gate (ratchets against the checked-in baseline)
//
// No fs / no http — the caller hands in an already-loaded RuleSet.

import type { RuleSet } from "@hookwarden/engine";

export const COMPLIANCE_FRAMEWORKS = [
  "soc2_cc",
  "iso27001",
  "eu_ai_act_annex_iii",
  "nist_ai_rmf",
] as const;

export type ComplianceFramework = (typeof COMPLIANCE_FRAMEWORKS)[number];

export interface ComplianceCoverage {
  readonly soc2_cc: number;
  readonly iso27001: number;
  readonly eu_ai_act_annex_iii: number;
  readonly nist_ai_rmf: number;
  // Full denominator: ALL shipped rules, mapped or not (keeps the stat honest, D-03).
  readonly total_rules: number;
}

/** True when the rule carries a non-empty array for `framework`. */
function hasMapping(
  mappings: { readonly [K in ComplianceFramework]?: ReadonlyArray<string> } | null,
  framework: ComplianceFramework,
): boolean {
  if (mappings === null || mappings === undefined) return false;
  const arr = mappings[framework];
  return Array.isArray(arr) && arr.length > 0;
}

/**
 * Tally per-framework non-empty mapping counts over the full rule denominator.
 * Iterates the loaded RuleSet (the same set `--version --verbose` reads).
 */
export function computeComplianceCoverage(ruleSet: Pick<RuleSet, "rules">): ComplianceCoverage {
  let soc2Cc = 0;
  let iso27001 = 0;
  let euAiActAnnexIii = 0;
  let nistAiRmf = 0;
  for (const rule of ruleSet.rules) {
    const m = rule.compliance_mappings;
    if (hasMapping(m, "soc2_cc")) soc2Cc++;
    if (hasMapping(m, "iso27001")) iso27001++;
    if (hasMapping(m, "eu_ai_act_annex_iii")) euAiActAnnexIii++;
    if (hasMapping(m, "nist_ai_rmf")) nistAiRmf++;
  }
  return {
    soc2_cc: soc2Cc,
    iso27001,
    eu_ai_act_annex_iii: euAiActAnnexIii,
    nist_ai_rmf: nistAiRmf,
    total_rules: ruleSet.rules.length,
  };
}

/**
 * Human-readable coverage stat line for `hookwarden --version --verbose`.
 * Shape (matches COMPLIANCE-01 must-have + the release.yml gate grep):
 *   "X of Y rules carry compliance_mappings: SOC2 X, ISO27001 Y, EU AI Act Annex III Z, NIST AI RMF W"
 * "X of Y" uses the count of rules carrying ANY mapping over the full denominator.
 */
export function formatComplianceCoverageLine(
  coverage: ComplianceCoverage,
  anyMappedCount: number,
): string {
  return (
    `${anyMappedCount} of ${coverage.total_rules} rules carry compliance_mappings: ` +
    `SOC2 ${coverage.soc2_cc}, ISO27001 ${coverage.iso27001}, ` +
    `EU AI Act Annex III ${coverage.eu_ai_act_annex_iii}, NIST AI RMF ${coverage.nist_ai_rmf}`
  );
}

/** Count of rules carrying a non-empty mapping for AT LEAST ONE framework. */
export function countRulesWithAnyMapping(ruleSet: Pick<RuleSet, "rules">): number {
  let n = 0;
  for (const rule of ruleSet.rules) {
    const m = rule.compliance_mappings;
    if (COMPLIANCE_FRAMEWORKS.some((fw) => hasMapping(m, fw))) n++;
  }
  return n;
}

/**
 * Coverage-regression check (ratchet). Returns the list of frameworks whose
 * CURRENT count dropped below the checked-in BASELINE. Empty array = no
 * regression (CI passes). The baseline is bumped in the same PR that adds
 * mappings, so the ratchet only ever rises.
 */
export function findCoverageRegressions(
  current: ComplianceCoverage,
  baseline: ComplianceCoverage,
): ReadonlyArray<{ framework: ComplianceFramework; current: number; baseline: number }> {
  const regressions: { framework: ComplianceFramework; current: number; baseline: number }[] = [];
  for (const fw of COMPLIANCE_FRAMEWORKS) {
    if (current[fw] < baseline[fw]) {
      regressions.push({ framework: fw, current: current[fw], baseline: baseline[fw] });
    }
  }
  return regressions;
}
