// @hookwarden/rules — provider evidence catalog + rule loader + predicate registry.
// Phase 2 ships this skeleton + one smoke-test rule. Phase 3 + 6 grow the rule library.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export { PROVIDER_CATALOG } from "./catalog.js";
export { computeContentHash, type LoadRuleSetInput, loadRuleSet } from "./loader.js";
export { ALL_PREDICATES } from "./predicates/index.js";
export { type ParsedMatcher, type ParsedRuleDocument, validateRuleDocument } from "./schema.js";

// Versioned in lockstep with rule_pack_version (D-05 Changesets). Read from package.json at
// module load time so the constant cannot drift from the published version. Predicate-purity
// rules (.dependency-cruiser.cjs `rules-predicates-no-node-core`) apply only to
// `packages/rules/src/predicates/**` — the rules-package root may use `node:fs`.
const moduleDir = dirname(fileURLToPath(import.meta.url));
// Resolve from both src/ (vitest) and dist/ (published) — package.json sits one level up in both.
const pkg = JSON.parse(readFileSync(join(moduleDir, "..", "package.json"), "utf8")) as {
  version: string;
};
export const RULES_PACK_VERSION: string = pkg.version;
