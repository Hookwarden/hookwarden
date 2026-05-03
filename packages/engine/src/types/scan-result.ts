// D-35: ScanResult bundle shape — atomic snapshot of findings + inventory + metadata.
// D-38: ScanMetadata fields — every field surfaced through CLI/SaaS for ENGINE-08.
// D-64: parse_candidates_count is the extension-allowlisted denominator for the CLI-side parse-coverage gate.
//       Population happens in Plan 09 (packages/cli/src/pipeline.ts) by overriding ScanResult.metadata
//       after engine.evaluate(...) returns. This preserves engine purity (D-01): the engine never
//       imports from packages/cli/, never reads the walker's allowlist, never knows the candidate count.

import type { Finding } from "./finding.ts";
import type { WebhookHandler } from "./handler.ts";

// D-38 — every field surfaced through CLI/SaaS for ENGINE-08.
export interface ScanMetadata {
  readonly engine_version: string; // matches package.json version of @hookwarden/engine
  readonly engine_commit_sha: string | null; // null when run outside a git checkout
  readonly rule_pack_version: string; // matches package.json of @hookwarden/rules
  readonly rule_pack_content_hash: string; // sha256 of canonicalized RuleSet, computed by rule loader
  readonly scanned_at: string; // ISO-8601 UTC, supplied by caller via Config to keep engine pure
  readonly parse_errors_count: number;
  readonly parsed_files_count: number;
  readonly total_files_count: number;
  readonly parse_candidates_count: number; // D-64: extension-allowlisted file count (denominator for CLI-side parse-coverage gate). POPULATED at the CLI tier in Plan 09 pipeline.ts (engine never reads the walker count); engine emit sites should set 0 as a safe default.
}

// D-35 — atomic scan snapshot. Replaces the Phase 1 `Promise<Finding[]>` return type.
export interface ScanResult {
  readonly findings: ReadonlyArray<Finding>;
  readonly inventory: ReadonlyArray<WebhookHandler>;
  readonly metadata: ScanMetadata;
}
