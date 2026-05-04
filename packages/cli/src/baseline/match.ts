// D-68 baseline matcher: match key is (rule_id, primary_location_line_hash); file-path drift
// still suppresses the finding but surfaces a stderr drift note.
// D-70 rule-pack drift: a baseline written under a different rule pack version is accepted with
// a single one-per-scan stderr note.
//
// Pure data transform — Plan 09 builds the matcher once per scan and calls applyBaseline per
// finding inside the suppression-merge step.

import type { Finding } from "@hookwarden/engine";
import type { BaselineDocument, BaselinedFinding } from "./schema.js";

export interface BaselineMatcher {
  readonly index: ReadonlyMap<string, BaselinedFinding>;
  readonly baselined_at: string;
  readonly rule_pack_version: string;
}

export interface BaselineApplyResult {
  readonly finding: Finding;
  readonly drift_note: string | null;
}

function key(ruleId: string, hash: string): string {
  return `${ruleId}|${hash}`;
}

export function buildBaselineMatcher(baseline: BaselineDocument): BaselineMatcher {
  const index = new Map<string, BaselinedFinding>();
  for (const f of baseline.findings) {
    index.set(key(f.rule_id, f.primary_location_line_hash), f);
  }
  return {
    index,
    baselined_at: baseline.baselined_at,
    rule_pack_version: baseline.rule_pack_version,
  };
}

export function applyBaseline(finding: Finding, matcher: BaselineMatcher): BaselineApplyResult {
  const matched = matcher.index.get(key(finding.rule_id, finding.primary_location_line_hash));
  if (!matched) {
    return { finding, drift_note: null };
  }
  const driftNote =
    matched.file_path !== finding.file_path
      ? `baseline file_path drift: ${matched.file_path} → ${finding.file_path}`
      : null;
  return {
    finding: {
      ...finding,
      suppressed: { source: "baseline", baselined_at: matcher.baselined_at },
    },
    drift_note: driftNote,
  };
}

export function detectRulePackDrift(
  baseline: BaselineDocument,
  currentRulePackVersion: string,
): string | null {
  if (baseline.rule_pack_version === currentRulePackVersion) return null;
  return `note: baseline rule pack ${baseline.rule_pack_version} differs from current ${currentRulePackVersion} — unmatched fingerprints are treated as new`;
}
