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
  readonly language?: "js" | "ts" | "python" | "php" | "go";
  readonly provider?: string;
}

// Finding shape as emitted in the MCP Tool.result structuredContent. Mirrors
// the engine Finding but flattens the SourceLocation block and renames
// `state` → `verdict` for MCP-facing readability (3-state vocabulary
// preserved verbatim per D-23-05).
export interface ScanHandlerFinding {
  readonly rule_id: string;
  readonly provider: string;
  readonly severity: string;
  readonly verdict: "verified" | "not-verified" | "manual-review";
  readonly file: string;
  readonly line_start: number;
  readonly line_end: number;
  readonly message: string;
  readonly provider_docs_url: string | null;
  readonly rule_pack_version: string;
}

export interface ScanHandlerVerdictSummary {
  readonly verified: number;
  readonly not_verified: number;
  readonly manual_review: number;
  readonly parse_error: number;
}

export interface ScanHandlerStructuredContent {
  readonly verdict_summary: ScanHandlerVerdictSummary;
  readonly findings: ReadonlyArray<ScanHandlerFinding>;
  readonly scan_metadata: {
    readonly engine_version: string;
    readonly rule_pack_version: string;
    readonly rule_pack_content_hash: string;
  };
}

// Tool.result is consumed by the MCP SDK which expects MUTABLE arrays for
// content[]; mark non-readonly so server.ts can pass the value through
// without a structural cast.
export interface ScanHandlerOutput {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: ScanHandlerStructuredContent | (Record<string, unknown> & { error: string });
  isError?: boolean;
}

// ─── verify_audit_chain tool contracts (Plan 25-02 / MCP-02) ───────────────
//
// Offline, no-auth verification of a hookwarden evidence pack: walk the
// per-row hash chain, roundtrip the manifest hash, and (for v1.1 packs that
// embed the signing CMK's SPKI public key) verify the ECDSA-P256 Merkle-root
// + manifest signatures with node:crypto — no AWS call, no credentials.
export interface VerifyAuditChainInput {
  readonly evidence_pack_json: string;
}

export interface VerifyAuditChainStructuredContent {
  // true iff the hash chain is intact AND the manifest hash roundtrips AND
  // all signatures that COULD be verified offline verified.
  readonly valid: boolean;
  // The `seq` of the first row whose chain hash did not match, or null if the
  // chain is intact. Signature validity is independent of chain integrity.
  readonly broken_at_row: number | null;
  // Count of offline-verified signatures: N Merkle-root signatures + 1
  // manifest signature (N+1). 0 for v1.0 packs (no embedded public key).
  readonly signatures_verified: number;
}

// Same content/structuredContent/isError shape as ScanHandlerOutput.
export interface VerifyAuditChainOutput {
  content: Array<{ type: "text"; text: string }>;
  structuredContent:
    | VerifyAuditChainStructuredContent
    | (Record<string, unknown> & { error: string });
  isError?: boolean;
}
