// D-35: ScanResult bundle shape — atomic snapshot of findings + inventory + metadata.
// D-38: ScanMetadata fields — every field surfaced through CLI/SaaS for ENGINE-08.

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
}

// D-35 — atomic scan snapshot. Replaces the Phase 1 `Promise<Finding[]>` return type.
export interface ScanResult {
  readonly findings: ReadonlyArray<Finding>;
  readonly inventory: ReadonlyArray<WebhookHandler>;
  readonly metadata: ScanMetadata;
}
