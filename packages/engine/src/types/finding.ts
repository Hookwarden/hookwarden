// D-29: Verdict three-state output.
// D-30: FindingId is a stable composite hash string.
// D-37: Composite stable id is sha256 hex from WebCrypto.
// D-39: snippet is the structurally redacted slice.
// D-63: Suppressed findings stay in findings[] with a payload describing the source.
//       Engine emits suppressed = null/undefined; the CLI Phase 4 suppression annotator
//       populates non-null values. The field is optional so existing engine emit sites
//       compile unchanged.
// ENGINE-04: Finding carries fingerprint, file path, line:col, severity, provider,
//            three-state state field, and redacted snippet.

export type Severity = "critical" | "high" | "medium" | "low" | "info";

// D-63: Three sources of suppression. Inline = `// hookwarden-disable-*` comments,
// ignore = `.hookwardenignore` patterns, baseline = `.hookwarden.baseline.json` entries.
export type SuppressionSource = "inline" | "ignore" | "baseline";

export interface SuppressedPayload {
  readonly source: SuppressionSource;
  readonly pattern?: string; // ignore: matched gitignore pattern
  readonly comment?: string; // inline: redacted-safe comment text
  readonly baselined_at?: string; // baseline: ISO-8601 from baseline file
}

// Three-state output per PITFALLS #3 + D-29. Rule emits this directly; engine does not derive.
export type Verdict = "verified" | "not-verified" | "manual-review";

// Composite stable id (D-37). Always a sha256 hex string from WebCrypto.
export type FindingId = string;

export interface SourceLocation {
  readonly line: number; // 1-indexed
  readonly col: number; // 1-indexed
  readonly end_line: number;
  readonly end_col: number;
}

export interface Finding {
  readonly id: FindingId;
  readonly rule_id: string; // e.g. "stripe/missing-verification" or "engine/parse-error"
  readonly provider: string; // e.g. "stripe", "github", "unknown"
  readonly severity: Severity;
  readonly state: Verdict; // D-29
  readonly file_path: string; // repo-relative
  readonly location: SourceLocation;
  readonly snippet: string; // D-39 structurally redacted; literals replaced
  readonly handler_id: string | null; // back-reference to WebhookHandler.id; null for parse-error findings
  readonly primary_location_line_hash: string; // ENGINE-04, SARIF 2.1.0 partialFingerprints semantic
  readonly message: string; // human-readable; rendered by CLI/SaaS
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
  readonly suppressed?: SuppressedPayload | null; // D-63: optional in engine output (always null/undefined); CLI suppression annotator populates non-null values.
}
