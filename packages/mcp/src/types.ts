// Contracts shared across the MCP server runtime. Plan 23-02 defines them
// here so Plan 23-05 (scan-handler) can import them without re-design.

// ─── Build-time manifest (emitted by Plan 23-03's emit-build-manifest.mjs,
//     read at boot by drift-check.ts) ─────────────────────────────────────
//
// engine.content_hash is `null` per RESEARCH Assumption A7: @hookwarden/engine
// does not export a content hash in v0.7.0; engine drift is version-only.
// See apps/docs/.../drift-detection.mdx "Known limitations" (Plan 23-07) for
// the user-facing disclosure.
export interface BuildManifest {
  readonly engine: {
    readonly version: string;
    readonly content_hash: null;
  };
  readonly rules: {
    readonly version: string;
    readonly content_hash: string;
  };
  readonly built_at: string;
}

// ─── Drift error payload (D-23-12) ─────────────────────────────────────────
//
// 4 required fields per VALIDATION line 919: pinned, current, suggestion,
// rationale. error + component classify the drift.
export interface DriftError {
  readonly error: "engine_drift" | "rules_drift";
  readonly component: "engine" | "rules";
  readonly pinned: string;
  readonly current: string;
  readonly suggestion: string;
  readonly rationale: string;
}

// ─── scan_handler tool contracts (Plan 23-05 consumer) ─────────────────────
//
// Mirrors the MCP `Tool.result` shape per spec 2025-06-18 + SDK 1.29.0 with
// structuredContent first-class (supersedes D-23-04 per RESEARCH Pitfall 5).
export interface ScanHandlerInput {
  readonly code?: string;
  readonly files?: Readonly<Record<string, string>>;
  readonly language?: "js" | "ts" | "python" | "php";
  readonly provider?: string;
}

export interface ScanHandlerFinding {
  readonly rule_id: string;
  readonly provider: string;
  readonly severity: string;
  readonly verdict: "verified" | "not-verified" | "manual-review";
  readonly file_path: string;
  readonly line_start: number;
  readonly line_end: number;
  readonly snippet: string;
  readonly message: string;
}

export interface ScanHandlerStructuredContent {
  readonly findings: ReadonlyArray<ScanHandlerFinding>;
  readonly engine_version: string;
  readonly rules_pack_version: string;
  readonly rules_content_hash: string;
  readonly scanned_files: number;
  readonly scanned_loc: number;
}

export interface ScanHandlerOutput {
  readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>;
  readonly structuredContent: ScanHandlerStructuredContent | { readonly error: string; readonly [key: string]: unknown };
  readonly isError?: boolean;
}
