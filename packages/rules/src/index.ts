// @hookwarden/rules — provider evidence catalog + rule loader + predicate registry.
// Phase 2 ships this skeleton + one smoke-test rule. Phase 3 + 6 grow the rule library.

export { PROVIDER_CATALOG } from "./catalog.js";
export { computeContentHash, type LoadRuleSetInput, loadRuleSet } from "./loader.js";
export { ALL_PREDICATES } from "./predicates/index.js";
export { type ParsedMatcher, type ParsedRuleDocument, validateRuleDocument } from "./schema.js";

// Versioned in lockstep with rule_pack_version (D-05 Changesets).
export const RULES_PACK_VERSION = "0.0.1";
