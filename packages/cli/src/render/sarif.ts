// D-60 severity mapping. D-76 SARIF 2.1.0 runtime conformance. D-29 three-state preservation. D-63 per-result suppressions[].
// Pure renderer: (ScanResult, RuleSet, stale, opts) → string. No fs / no process writes.

import type { Finding, RuleDefinition, RuleSet, ScanResult, Severity } from "@hookwarden/engine";
import type { StaleSuppression } from "../suppress/stale.js";

export const SARIF_LEVEL_BY_SEVERITY: Readonly<Record<Severity, "error" | "warning" | "note">> = {
  critical: "error",
  high: "error",
  medium: "warning",
  low: "note",
  info: "note",
};

const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const SARIF_SCHEMA_URI =
  "https://docs.oasis-open.org/sarif/sarif/v2.1.0/cs01/schemas/sarif-schema-2.1.0.json";
const HOOKWARDEN_INFO_URI = "https://hookwarden.dev";

export interface RenderSarifInputs {
  readonly scanResult: ScanResult;
  readonly ruleSet: RuleSet | null;
  // Accepted for renderer-signature parity with renderJson; SARIF has no native stale concept.
  readonly stale: ReadonlyArray<StaleSuppression>;
}

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

function ruleToDriverRule(r: RuleDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: r.rule_id,
    shortDescription: { text: r.message },
    fullDescription: { text: r.message },
    defaultConfiguration: { level: SARIF_LEVEL_BY_SEVERITY[r.severity] },
    properties: { "hookwarden-severity": r.severity },
  };
  if (r.provider_docs_url && r.provider_docs_url.length > 0) {
    out["helpUri"] = r.provider_docs_url;
  }
  return out;
}

function suppressionEntry(s: NonNullable<Finding["suppressed"]>): {
  kind: "external" | "inSource";
  justification: string;
} {
  // D-63 + D-76: hookwarden suppression source → SARIF kind.
  // inline → inSource (lives in source as a comment); ignore + baseline → external (out-of-source files).
  const kind: "external" | "inSource" = s.source === "inline" ? "inSource" : "external";
  const parts: string[] = [`source=${s.source}`];
  if (s.pattern) parts.push(`pattern=${s.pattern}`);
  if (s.comment) parts.push(`comment=${s.comment}`);
  if (s.baselined_at) parts.push(`baseline=${s.baselined_at}`);
  return { kind, justification: parts.join(" ") };
}

function findingToResult(f: Finding): Record<string, unknown> {
  const result: Record<string, unknown> = {
    ruleId: f.rule_id,
    level: SARIF_LEVEL_BY_SEVERITY[f.severity],
    message: { text: f.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: f.file_path, uriBaseId: "%SRCROOT%" },
          region: { startLine: f.location.line, startColumn: f.location.col },
        },
      },
    ],
    partialFingerprints: { primaryLocationLineHash: f.primary_location_line_hash },
    properties: { "hookwarden-state": f.state },
  };
  if (f.suppressed != null) {
    result["suppressions"] = [suppressionEntry(f.suppressed)];
  }
  return result;
}

export function renderSarif(inputs: RenderSarifInputs): string {
  const { scanResult, ruleSet } = inputs;
  const meta = scanResult.metadata;
  const sortedFindings = [...scanResult.findings].sort(compareFindings);

  const driver: Record<string, unknown> = {
    name: "hookwarden",
    version: meta.engine_version,
    semanticVersion: meta.engine_version,
    informationUri: HOOKWARDEN_INFO_URI,
    rules: ruleSet ? ruleSet.rules.map(ruleToDriverRule) : [],
  };

  const sarif = {
    $schema: SARIF_SCHEMA_URI,
    version: "2.1.0",
    runs: [
      {
        tool: { driver },
        results: sortedFindings.map(findingToResult),
      },
    ],
  };

  // SARIF spec does NOT require sorted JSON keys — Code Scanning ingests by schema, not byte stream.
  // Determinism comes from sorted findings + deterministic RuleSet iteration order.
  return `${JSON.stringify(sarif, null, 2)}\n`;
}
