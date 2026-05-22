// @hookwarden/fix — auto-remediation engine entry point.
// D-05: bounded location for @babel/traverse + @babel/generator. Engine stays pure.
// D-23: source lives only in the public OSS repo.
//
// Implementations land in Phase 8.2 Waves 2–5; this file is the signature-only
// barrel that downstream waves and the CLI fix subcommand consume.

import type { RuleSet, ScanResult } from "@hookwarden/engine";

export interface ImportToAdd {
  // JS/TS: `import { default_name } from "specifier";` or `const default_name = require("specifier");`
  // Python: `import module`
  // PHP: not used (hash_equals, hmac, etc. are core).
  readonly specifier?: string;
  readonly default_name?: string;
  readonly module?: string;
}

export interface FixEdit {
  readonly ruleId: string;
  readonly routineId: string;
  readonly filePath: string;
  readonly startByte: number;
  readonly endByte: number;
  readonly start: { readonly line: number; readonly col: number };
  readonly end: { readonly line: number; readonly col: number };
  readonly before: string;
  readonly after: string;
  readonly safety: "safe" | "unsafe" | "manual-only";
  // Phase 8.2 D-11 condition 4: codegen can declare imports it needs.
  // Plan 08 orchestrator inserts these atomically with the edit.
  readonly importsToAdd?: ReadonlyArray<ImportToAdd>;
}

export interface FixOptions {
  readonly mode: "safe" | "all" | "manual-only-explain";
  readonly write: boolean;
  readonly only?: ReadonlyArray<string>;
  readonly format?: "text" | "json";
  readonly acceptUnsafe?: boolean;
}

export interface FixResult {
  readonly fixes: ReadonlyArray<FixEdit>;
  readonly applied: number;
  readonly skipped: number;
  readonly rejected: ReadonlyArray<{ readonly edit: FixEdit; readonly reason: string }>;
  readonly rescan: { readonly ok: boolean; readonly newFindings: number } | null;
}

export async function applyFixes(
  _scan: ScanResult,
  _ruleSet: RuleSet,
  _opts: FixOptions,
): Promise<FixResult> {
  throw new Error("not yet implemented — see Phase 8.2 Wave 5 plan (08.2-08)");
}

export async function dryRunFixes(
  _scan: ScanResult,
  _ruleSet: RuleSet,
  _opts: Omit<FixOptions, "write">,
): Promise<FixResult> {
  throw new Error("not yet implemented — see Phase 8.2 Wave 5 plan (08.2-08)");
}
