// Finding-shape types the renderer accepts.
//
// Mirrors Phase 4 D-59 JSON envelope (packages/cli/src/render/json.ts) as the wire
// format both consumers (GitHub Action + SaaS worker) parse from CLI stdout or
// from server-side scans. Field names here MUST match the envelope emitted by
// `hookwarden scan --format json` byte-for-byte.
//
// Owned by @hookwarden/pr-renderer because the renderer is the only thing in
// the OSS repo that depends on these types' shape. @hookwarden/github-action
// re-exports them from here.

export interface ScanFindingLocation {
  readonly line: number;
  readonly col: number;
}

export interface ScanFinding {
  readonly finding_id: string;
  readonly rule_id: string;
  readonly provider: string | null;
  readonly severity: "critical" | "high" | "medium" | "low" | "info";
  readonly state: "verified" | "not-verified" | "manual-review";
  readonly file_path: string;
  readonly location: ScanFindingLocation;
  readonly primary_location_line_hash: string;
  readonly message: string;
  readonly redacted_snippet: string | null;
  readonly suppressed: { readonly source: "inline" | "ignore" | "baseline" } | null;
}
