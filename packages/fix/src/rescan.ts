// I/O module: re-scans a specific file list via an injected scan runner.
// Phase 8.2 D-11 condition 5: zero-new-findings gate after every applyFixes.
//
// The runner is supplied by the orchestrator (Plan 08) — typically the CLI's
// runScan with `fileList` set. Keeping this module dep-free of the CLI surface
// avoids a cycle in the static dep graph: @hookwarden/fix → hookwarden →
// @hookwarden/fix (via the codegen registry).

import type { ScanResult } from "@hookwarden/engine";

export interface RescanRunnerInput {
  readonly rootPath: string;
  readonly resolvedConfig: unknown;
  readonly diffOnly: boolean;
  readonly diffBase: string | null;
  readonly baselineWrite: boolean;
  readonly verbose: boolean;
  readonly fileList: ReadonlyArray<string>;
}

export type RescanRunner = (input: RescanRunnerInput) => Promise<{ readonly result: ScanResult }>;

export interface RescanFilesInput {
  readonly repoRoot: string;
  readonly files: ReadonlyArray<string>;
  readonly resolvedConfig: unknown;
  readonly runner: RescanRunner;
}

export async function rescanFiles(input: RescanFilesInput): Promise<ScanResult> {
  const out = await input.runner({
    rootPath: input.repoRoot,
    resolvedConfig: input.resolvedConfig,
    diffOnly: false,
    diffBase: null,
    baselineWrite: false,
    verbose: false,
    fileList: input.files,
  });
  return out.result;
}
