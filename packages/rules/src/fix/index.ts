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

export type CodegenRoutine = (parsedFile: ParsedFile, finding: Finding) => FixEdit | null;

export const ALL_CODEGEN_ROUTINES: Readonly<Record<string, CodegenRoutine>> = {
  "typescript-replace-binary-equality": typescriptReplaceBinaryEquality,
  "python-replace-binary-equality": pythonReplaceBinaryEquality,
  "php-replace-binary-equality-or-strcmp": phpReplaceBinaryEqualityOrStrcmp,
};
