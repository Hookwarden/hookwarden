// Shared types for the GitHub Action.
// Mirrors Phase 4 D-59 JSON envelope (packages/cli/src/render/json.ts) as the wire
// format the Action parses from CLI stdout. Field names here MUST match the envelope
// emitted by `hookwarden scan --format json` byte-for-byte.
//
// ScanFinding + ScanFindingLocation are owned by @hookwarden/pr-renderer (the
// renderer is the only thing in the OSS repo that semantically depends on the
// finding shape). They're re-exported here so existing imports under
// "./types.js" keep working without touching every consumer file.

import type { ScanFinding, ScanFindingLocation } from "@hookwarden/pr-renderer";

export type { ScanFinding, ScanFindingLocation };

export interface ActionInputs {
  readonly failOn: string;
  readonly configPath: string | undefined;
  readonly workingDirectory: string;
}

export interface SeverityCounts {
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
  readonly info: number;
}

export interface ScanJsonEnvelope {
  readonly schema_version: "1.0";
  readonly engine: { readonly version: string; readonly commit_sha: string };
  readonly rule_pack: { readonly version: string; readonly content_hash: string };
  readonly scan: {
    readonly scanned_at: string;
    readonly findings: ReadonlyArray<ScanFinding>;
    readonly counts: {
      readonly active: SeverityCounts;
      readonly suppressed: SeverityCounts;
    };
    readonly parse_errors_count: number;
    readonly parse_candidates_count: number;
    readonly total_files_count: number;
    readonly parsed_files_count: number;
  };
}

export interface ActionScanOutput {
  readonly findingsCount: number;
  readonly newFindingsCount: number;
  readonly bySeverity: SeverityCounts;
  readonly sarifPath: string;
  readonly newFindings: ReadonlyArray<ScanFinding>;
  readonly failed: boolean;
  readonly cliExitCode: number;
  readonly eventName: string;
  readonly isFork: boolean;
}
