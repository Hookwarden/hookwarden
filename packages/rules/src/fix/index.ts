// Phase 8.2 D-02: codegen routine registry.
// Mirrors the predicates/index.ts barrel pattern (D-93).
//
// Plan 06 ships 3 routines (timing-unsafe-comparison × 3 langs);
// Plan 07 adds 7 more (nullish-guard × 2, raw-body × 2, secret-presence × 3).

import type { Finding, ParsedFile } from "@hookwarden/engine";
import type { FixEdit } from "@hookwarden/fix";
import { typescriptReplaceBinaryEquality } from "./typescript-replace-binary-equality.js";
import { pythonReplaceBinaryEquality } from "./python-replace-binary-equality.js";
import { phpReplaceBinaryEqualityOrStrcmp } from "./php-replace-binary-equality-or-strcmp.js";
import { typescriptInsertNullishGuard } from "./typescript-insert-nullish-guard.js";
import { pythonInsertNullishGuard } from "./python-insert-nullish-guard.js";
import { typescriptReplaceReqBodyWithRawBody } from "./typescript-replace-req-body-with-raw-body.js";
import { phpReplaceInputWithRawBody } from "./php-replace-input-with-raw-body.js";
import { typescriptInsertSecretPresenceCheck } from "./typescript-insert-secret-presence-check.js";
import { pythonInsertSecretPresenceCheck } from "./python-insert-secret-presence-check.js";
import { phpInsertSecretPresenceCheck } from "./php-insert-secret-presence-check.js";

export type CodegenRoutine = (parsedFile: ParsedFile, finding: Finding) => FixEdit | null;

// 10 routines = 4 fix families × 3 langs MINUS 2 explicit omissions:
// - python-replace-request-data-with-raw-body: manual-only in v0.5 (B3 — D-11 cond. 2)
// - php-insert-nullish-guard: PHP's `??` / `isset()` idioms make a 1-line rewrite too invasive for v0.5
export const ALL_CODEGEN_ROUTINES: Readonly<Record<string, CodegenRoutine>> = {
  "typescript-replace-binary-equality": typescriptReplaceBinaryEquality,
  "python-replace-binary-equality": pythonReplaceBinaryEquality,
  "php-replace-binary-equality-or-strcmp": phpReplaceBinaryEqualityOrStrcmp,
  "typescript-insert-nullish-guard": typescriptInsertNullishGuard,
  "python-insert-nullish-guard": pythonInsertNullishGuard,
  "typescript-replace-req-body-with-raw-body": typescriptReplaceReqBodyWithRawBody,
  "php-replace-input-with-raw-body": phpReplaceInputWithRawBody,
  "typescript-insert-secret-presence-check": typescriptInsertSecretPresenceCheck,
  "python-insert-secret-presence-check": pythonInsertSecretPresenceCheck,
  "php-insert-secret-presence-check": phpInsertSecretPresenceCheck,
};
