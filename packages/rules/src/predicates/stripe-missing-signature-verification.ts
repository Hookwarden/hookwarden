// Phase 6 D-93 refactor: thin re-export shim. The implementation moved to the catalog-
// parameterized factory in `predicates/missing-signature-verification.ts`. This shim
// preserves the import path used by `predicates/index.ts` and any direct test imports.

export { stripeMissingSignatureVerificationPredicate } from "./missing-signature-verification.js";
