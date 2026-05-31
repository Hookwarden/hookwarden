// @hookwarden/rules — provider evidence catalog + rule loader + predicate registry.
// Phase 2 ships this skeleton + one smoke-test rule. Phase 3 + 6 grow the rule library.

export {
  BUNDLED_RULE_DOCUMENTS,
  type BundledRuleDocument,
} from "./bundled-rules.js";
export { PROVIDER_CATALOG } from "./catalog.js";
export {
  COMPLIANCE_FRAMEWORKS,
  type ComplianceCoverage,
  type ComplianceFramework,
  computeComplianceCoverage,
  countRulesWithAnyMapping,
  findCoverageRegressions,
  formatComplianceCoverageLine,
} from "./compliance-coverage.js";
export { ALL_CODEGEN_ROUTINES, type CodegenRoutine } from "./fix/index.js";
export { computeContentHash, type LoadRuleSetInput, loadRuleSet } from "./loader.js";
export { ALL_PREDICATES } from "./predicates/index.js";
export { type ParsedMatcher, type ParsedRuleDocument, validateRuleDocument } from "./schema.js";

// RULES_PACK_VERSION is generated from package.json by scripts/sync-version.mjs
// (runs in `prepare` + `prepack` + CI before `bun build --compile`). Generating
// a TS constant bakes the literal into both the npm-published dist/ AND the
// Bun compiled binary, side-stepping the runtime read-package.json failure
// inside Bun's virtual /$bunfs/ filesystem (Phase 4.2 DC-13 sibling fix —
// same pattern as packages/cli/src/version.ts).
export { RULES_PACK_VERSION } from "./version.js";
