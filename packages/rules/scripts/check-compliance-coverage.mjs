#!/usr/bin/env node
// Phase 25 COMPLIANCE-01 (D-03 / OQ#4) — CI coverage-regression gate.
//
// Computes the current per-framework compliance-mapping coverage from the
// loaded rule pack and FAILS (exit 1) if any framework count dropped below the
// checked-in baseline (packages/rules/compliance-coverage-baseline.json). The
// baseline is the ratchet: it is bumped in the same PR that adds mappings, so
// the coverage can only ever rise. Mirrors the block-release gate discipline of
// the existing pre-publish gates in .github/workflows/release.yml.
//
// Run from the repo root or anywhere — it resolves the built dist + baseline
// relative to this script. Requires `pnpm --filter @hookwarden/rules build`
// (or a full `tsc --build`) to have produced dist/index.js first.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distIndex = resolve(here, "../dist/index.js");
const baselinePath = resolve(here, "../compliance-coverage-baseline.json");

const {
  loadRuleSet,
  BUNDLED_RULE_DOCUMENTS,
  ALL_PREDICATES,
  PROVIDER_CATALOG,
  computeComplianceCoverage,
  findCoverageRegressions,
} = await import(distIndex);

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

const ruleSet = await loadRuleSet({
  rule_documents: BUNDLED_RULE_DOCUMENTS.map((e) => e.doc),
  predicates: ALL_PREDICATES,
  providers: PROVIDER_CATALOG,
  rule_pack_version: "0.0.0-ci-gate",
});

const current = computeComplianceCoverage(ruleSet);
const regressions = findCoverageRegressions(current, baseline);

process.stdout.write("Compliance coverage (current vs baseline):\n");
for (const fw of ["soc2_cc", "iso27001", "eu_ai_act_annex_iii", "nist_ai_rmf", "total_rules"]) {
  process.stdout.write(`  ${fw}: ${current[fw]} (baseline ${baseline[fw]})\n`);
}

if (regressions.length > 0) {
  console.error("\n::error::Compliance coverage regressed below the checked-in baseline:");
  for (const r of regressions) {
    console.error(`  ${r.framework}: ${r.current} < baseline ${r.baseline}`);
  }
  console.error(
    "\nIf this drop is intentional, update packages/rules/compliance-coverage-baseline.json in the same PR.",
  );
  process.exit(1);
}

process.stdout.write("\nNo coverage regression — gate passed.\n");
