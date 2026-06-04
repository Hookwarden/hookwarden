// Phase 8.2 Plan 11: language-agnostic codegen dispatchers.
//
// Each YAML rule references a SINGLE codegen id, but a rule can apply across
// multiple v1 languages (via applies_to). The dispatchers below take a
// parsedFile + finding and route to the appropriate per-language codegen by
// parsedFile.dialect. Each per-language codegen already guards against
// dialect mismatch + parse errors — the dispatcher is a thin lookup table.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { Finding, ParsedFile } from "@hookwarden/engine";
import type { FixEdit } from "@hookwarden/fix";
import { goReplaceBinaryEquality } from "./go-replace-binary-equality.js";
import { goReplaceBodyWithRaw } from "./go-replace-body-with-raw.js";
import { phpInsertSecretPresenceCheck } from "./php-insert-secret-presence-check.js";
import { phpReplaceBinaryEqualityOrStrcmp } from "./php-replace-binary-equality-or-strcmp.js";
import { phpReplaceInputWithRawBody } from "./php-replace-input-with-raw-body.js";
import { pythonInsertNullishGuard } from "./python-insert-nullish-guard.js";
import { pythonInsertSecretPresenceCheck } from "./python-insert-secret-presence-check.js";
import { pythonReplaceBinaryEquality } from "./python-replace-binary-equality.js";
import { typescriptInsertNullishGuard } from "./typescript-insert-nullish-guard.js";
import { typescriptInsertSecretPresenceCheck } from "./typescript-insert-secret-presence-check.js";
import { typescriptReplaceBinaryEquality } from "./typescript-replace-binary-equality.js";
import { typescriptReplaceReqBodyWithRawBody } from "./typescript-replace-req-body-with-raw-body.js";

export function dispatchTimingUnsafeComparison(
  parsedFile: ParsedFile,
  finding: Finding,
): FixEdit | null {
  switch (parsedFile.dialect) {
    case "babel":
      return typescriptReplaceBinaryEquality(parsedFile, finding);
    case "tree-sitter-python":
      return pythonReplaceBinaryEquality(parsedFile, finding);
    case "tree-sitter-php":
      return phpReplaceBinaryEqualityOrStrcmp(parsedFile, finding);
    case "tree-sitter-go":
      return goReplaceBinaryEquality(parsedFile, finding);
    case "n8n-json":
      return null; // n8n workflow JSON is structured config, not code — no autofix codegen.
  }
}

export function dispatchInsertNullishGuard(
  parsedFile: ParsedFile,
  finding: Finding,
): FixEdit | null {
  switch (parsedFile.dialect) {
    case "babel":
      return typescriptInsertNullishGuard(parsedFile, finding);
    case "tree-sitter-python":
      return pythonInsertNullishGuard(parsedFile, finding);
    case "tree-sitter-php":
      return null; // PHP nullish-guard is manual-only in v0.5 (PHP idiom rationale).
    case "tree-sitter-go":
      return null; // Go nullish-guard is manual-only (Go has no nullish-coalescing idiom).
    case "n8n-json":
      return null; // n8n workflow JSON is structured config, not code — no autofix codegen.
  }
}

export function dispatchReplaceRawBodyMisuse(
  parsedFile: ParsedFile,
  finding: Finding,
): FixEdit | null {
  switch (parsedFile.dialect) {
    case "babel":
      return typescriptReplaceReqBodyWithRawBody(parsedFile, finding);
    case "tree-sitter-php":
      return phpReplaceInputWithRawBody(parsedFile, finding);
    case "tree-sitter-go":
      return goReplaceBodyWithRaw(parsedFile, finding);
    case "tree-sitter-python":
      return null; // Python raw-body is manual-only in v0.5 (B3 — D-11 cond. 2).
    case "n8n-json":
      return null; // n8n workflow JSON is structured config, not code — no autofix codegen.
  }
}

export function dispatchInsertSecretPresenceCheck(
  parsedFile: ParsedFile,
  finding: Finding,
): FixEdit | null {
  switch (parsedFile.dialect) {
    case "babel":
      return typescriptInsertSecretPresenceCheck(parsedFile, finding);
    case "tree-sitter-python":
      return pythonInsertSecretPresenceCheck(parsedFile, finding);
    case "tree-sitter-php":
      return phpInsertSecretPresenceCheck(parsedFile, finding);
    case "tree-sitter-go":
      return null; // Go secret-presence-check is manual-only in this milestone (no Go codegen yet).
    case "n8n-json":
      return null; // n8n workflow JSON is structured config, not code — no autofix codegen.
  }
}
