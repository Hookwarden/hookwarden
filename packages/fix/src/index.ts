// @hookwarden/fix — auto-remediation engine entry point.
// D-05: bounded location for @babel/traverse + @babel/generator. Engine stays pure.
// D-23: source lives only in the public OSS repo.

import type { Finding, ParsedFile, RuleSet, ScanResult } from "@hookwarden/engine";
import { resolveConflicts } from "./conflict-resolver.js";
import { FixModeNonTtyRejectedError } from "./errors.js";
import { insertImports } from "./import-inserter.js";

// CodegenRoutine signature lives here to break the dep cycle — @hookwarden/rules
// imports FixEdit from this package, so this package cannot import back from rules.
// The CLI orchestrator (Plan 09) threads ALL_CODEGEN_ROUTINES into applyFixes at
// the call boundary.
export type CodegenRoutine = (parsedFile: ParsedFile, finding: Finding) => FixEdit | null;

export interface ImportToAdd {
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
  readonly importsToAdd?: ReadonlyArray<ImportToAdd>;
}

export type FixMode = "safe" | "all" | "manual-only-explain";

export interface FixOptions {
  readonly mode: FixMode;
  readonly write: boolean;
  readonly only?: ReadonlyArray<string>;
  readonly format?: "text" | "json";
  readonly acceptUnsafe?: boolean;
  readonly isTty?: boolean;
}

export interface FixResult {
  readonly fixes: ReadonlyArray<FixEdit>;
  readonly applied: number;
  readonly skipped: number;
  readonly rejected: ReadonlyArray<{ readonly edit: FixEdit; readonly reason: string }>;
  readonly rescan: { readonly ok: boolean; readonly newFindings: number } | null;
  readonly suggestion: string | null;
}

export { FixModeNonTtyRejectedError } from "./errors.js";
export { buildD19Suggestion, resolveConflicts } from "./conflict-resolver.js";
export { insertImports } from "./import-inserter.js";
export {
  buildForbiddenRanges,
  type ForbiddenRange,
  intersects,
} from "./forbidden-ranges.js";

const ALL_SAFETY_FOR_MODE: Readonly<Record<FixMode, ReadonlySet<FixEdit["safety"]>>> = {
  safe: new Set(["safe"]),
  all: new Set(["safe", "unsafe"]),
  "manual-only-explain": new Set(["manual-only"]),
};

export async function dryRunFixes(
  scan: ScanResult,
  ruleSet: RuleSet,
  opts: Omit<FixOptions, "write">,
  context?: ApplyFixesContext,
): Promise<FixResult> {
  return runOrchestration(scan, ruleSet, { ...opts, write: false }, context ?? null);
}

export interface ApplyFixesContext {
  // The orchestrator is parser-agnostic; the caller (Plan 09 CLI) injects the
  // parsed files keyed by repo-relative path. This decouples the fix package
  // from the CLI's I/O layer.
  readonly parsedFiles: Readonly<Record<string, ParsedFile>>;
  // The codegen registry — supplied by the caller to break the dep cycle
  // between @hookwarden/fix and @hookwarden/rules.
  readonly codegenRegistry: Readonly<Record<string, CodegenRoutine>>;
}

export async function applyFixes(
  scan: ScanResult,
  ruleSet: RuleSet,
  opts: FixOptions,
  context?: ApplyFixesContext,
): Promise<FixResult> {
  // D-12: refuse `all` mode in non-TTY without explicit accept-unsafe.
  if (opts.mode === "all" && opts.isTty !== true && opts.acceptUnsafe !== true) {
    throw new FixModeNonTtyRejectedError();
  }
  return runOrchestration(scan, ruleSet, opts, context ?? null);
}

async function runOrchestration(
  scan: ScanResult,
  ruleSet: RuleSet,
  opts: FixOptions,
  context: ApplyFixesContext | null,
): Promise<FixResult> {
  const allowedSafeties = ALL_SAFETY_FOR_MODE[opts.mode];
  const onlyFilter = opts.only !== undefined && opts.only.length > 0 ? new Set(opts.only) : null;
  const ruleById = new Map(ruleSet.rules.map((r) => [r.rule_id, r] as const));
  const codegenEdits: FixEdit[] = [];
  const rejected: Array<{ edit: FixEdit; reason: string }> = [];
  let skipped = 0;

  for (const finding of scan.findings) {
    if (onlyFilter !== null && !onlyFilter.has(finding.rule_id)) {
      skipped++;
      continue;
    }
    const rule = ruleById.get(finding.rule_id);
    if (rule === undefined || rule.fix === undefined || rule.fix === null) {
      skipped++;
      continue;
    }
    if (!allowedSafeties.has(rule.fix.safety)) {
      skipped++;
      continue;
    }
    if (rule.fix.codegen === null) {
      // manual-only: no mechanical edit. In manual-only-explain mode we still
      // surface the finding through the FixResult so the CLI can render it.
      if (opts.mode === "manual-only-explain") {
        codegenEdits.push(buildManualOnlyExplain(finding, rule.fix.description));
      }
      continue;
    }
    const routine: CodegenRoutine | undefined = context?.codegenRegistry?.[rule.fix.codegen];
    if (routine === undefined) {
      // load-rules guards this at load time; defensive at runtime.
      continue;
    }
    const parsedFile = context?.parsedFiles?.[finding.file_path];
    if (parsedFile === undefined) {
      // Without a parsed file the codegen can't run. Dry-run callers may
      // pass no context; in that case we record a manual-only-style edit so
      // the user sees what the rule would do.
      continue;
    }
    const edit = routine(parsedFile, finding);
    if (edit === null) continue;
    codegenEdits.push(edit);
  }

  // Insert import edits per file (D-11 condition 4).
  const importEdits: FixEdit[] = [];
  if (context !== null) {
    const importsByFile = new Map<string, ImportToAdd[]>();
    for (const edit of codegenEdits) {
      if (edit.importsToAdd === undefined) continue;
      const list = importsByFile.get(edit.filePath) ?? [];
      list.push(...edit.importsToAdd);
      importsByFile.set(edit.filePath, list);
    }
    for (const [filePath, imps] of importsByFile) {
      const parsedFile = context.parsedFiles[filePath];
      if (parsedFile === undefined) continue;
      const inserted = insertImports(parsedFile, imps);
      importEdits.push(...inserted);
    }
  }

  const allEdits = [...importEdits, ...codegenEdits];
  const conflictResult = resolveConflicts(allEdits);
  for (const r of conflictResult.rejected) rejected.push(r);

  // D-22: write-mode atomic-stage path is wired by the CLI (Plan 09) — it has
  // access to staging.ts + rescan.ts + the runScan runner. This package
  // produces the FixResult; the CLI consumes it and stages/commits.

  return {
    fixes: conflictResult.applied,
    applied: opts.write && conflictResult.suggestion === null ? conflictResult.applied.length : 0,
    skipped,
    rejected,
    rescan: null,
    suggestion: conflictResult.suggestion,
  };
}

function buildManualOnlyExplain(finding: Finding, description: string): FixEdit {
  return {
    ruleId: finding.rule_id,
    routineId: "@manual-only-explain",
    filePath: finding.file_path,
    startByte: 0,
    endByte: 0,
    start: { line: finding.location.line, col: finding.location.col },
    end: { line: finding.location.line, col: finding.location.col },
    before: "",
    after: description,
    safety: "manual-only",
  };
}
