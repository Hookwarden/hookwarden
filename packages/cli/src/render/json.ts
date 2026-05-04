// D-59 JSON envelope. D-63 dual-bucket counts. D-67 stale block. Sorted keys (specifics §"JSON sorted-keys").
// Pure renderer: (ScanResult, RuleSet, stale, opts) → string.

import type {
  Finding,
  RuleSet,
  ScanResult,
  Severity,
  Verdict,
  WebhookHandler,
} from "@hookwarden/engine";
import type { StaleSuppression } from "../suppress/stale.js";

export interface RenderJsonInputs {
  readonly scanResult: ScanResult;
  readonly ruleSet: RuleSet | null;
  readonly stale: ReadonlyArray<StaleSuppression>;
}

interface FindingPayload {
  readonly finding_id: string;
  readonly rule_id: string;
  readonly provider: string | null;
  readonly severity: Severity;
  readonly state: Verdict;
  readonly file_path: string;
  readonly location: { readonly line: number; readonly col: number };
  readonly primary_location_line_hash: string;
  readonly message: string;
  readonly redacted_snippet: string | null;
  readonly suppressed: Finding["suppressed"];
}

interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function compareFindings(a: Finding, b: Finding): number {
  const sa = SEVERITY_RANK[a.severity];
  const sb = SEVERITY_RANK[b.severity];
  if (sa !== sb) return sa - sb;
  if (a.file_path !== b.file_path) return a.file_path < b.file_path ? -1 : 1;
  if (a.location.line !== b.location.line) return a.location.line - b.location.line;
  if (a.location.col !== b.location.col) return a.location.col - b.location.col;
  if (a.rule_id < b.rule_id) return -1;
  if (a.rule_id > b.rule_id) return 1;
  return 0;
}

function emptyCounts(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

function tabulate(findings: ReadonlyArray<Finding>): {
  active: SeverityCounts;
  suppressed: SeverityCounts;
} {
  const active = emptyCounts();
  const suppressed = emptyCounts();
  for (const f of findings) {
    const bucket = f.suppressed != null ? suppressed : active;
    bucket[f.severity] += 1;
  }
  return { active, suppressed };
}

function findingId(f: Finding): string {
  // Composite ID: <rule_id>@<primary_location_line_hash>. Stable across runs.
  return `${f.rule_id}@${f.primary_location_line_hash}`;
}

function toFindingPayload(f: Finding): FindingPayload {
  return {
    finding_id: findingId(f),
    rule_id: f.rule_id,
    provider: f.provider,
    severity: f.severity,
    state: f.state,
    file_path: f.file_path,
    location: { line: f.location.line, col: f.location.col },
    primary_location_line_hash: f.primary_location_line_hash,
    message: f.message,
    redacted_snippet: f.snippet, // D-39: engine.snippet is the redacted slice
    suppressed: f.suppressed ?? null,
  };
}

function toHandlerPayload(h: WebhookHandler): unknown {
  // D-37: composite handler ID preserved. JSON round-trip strips Maps/Sets and class instances
  // (engine guarantees plain readonly objects), giving us a stable serializable shape.
  return JSON.parse(JSON.stringify(h));
}

// Recursive lexicographic key-sort. Preserves array order (arrays carry positional meaning).
function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    sorted[k] = sortKeysDeep(obj[k]);
  }
  return sorted;
}

export function renderJson(inputs: RenderJsonInputs): string {
  const { scanResult, stale } = inputs;
  const sortedFindings = [...scanResult.findings].sort(compareFindings);
  const findingsPayload = sortedFindings.map(toFindingPayload);
  const counts = tabulate(scanResult.findings);
  const meta = scanResult.metadata;

  const applied = sortedFindings
    .filter((f) => f.suppressed != null)
    .map((f) => ({
      finding_id: findingId(f),
      // f.suppressed has been narrowed by the filter above
      source: (f.suppressed as NonNullable<Finding["suppressed"]>).source,
    }));

  const envelope = {
    schema_version: "1.0",
    engine: {
      version: meta.engine_version,
      commit_sha: meta.engine_commit_sha,
    },
    rule_pack: {
      version: meta.rule_pack_version,
      content_hash: meta.rule_pack_content_hash,
    },
    scan: {
      scanned_at: meta.scanned_at,
      findings: findingsPayload,
      inventory: scanResult.inventory.map(toHandlerPayload),
      counts: { active: counts.active, suppressed: counts.suppressed },
      parse_errors_count: meta.parse_errors_count,
      parse_candidates_count: meta.parse_candidates_count,
      total_files_count: meta.total_files_count,
      parsed_files_count: meta.parsed_files_count,
    },
    suppressions: {
      applied,
      stale: [...stale],
    },
  };

  const sorted = sortKeysDeep(envelope);
  return `${JSON.stringify(sorted, null, 2)}\n`;
}
