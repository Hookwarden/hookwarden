// D-63 annotateSuppressions: post-engine-emit; precedence inline > ignore > baseline.

import type { Finding } from "@hookwarden/engine";
import type { IgnoreFilter } from "./ignore-file.js";
import type { InlineSuppressions } from "./inline-comments.js";

export interface BaselineLike {
  readonly findings: ReadonlyArray<{
    readonly rule_id: string;
    readonly primary_location_line_hash: string;
  }>;
  readonly baselined_at: string;
}

function buildBaselineIndex(b: BaselineLike): Set<string> {
  const idx = new Set<string>();
  for (const f of b.findings) idx.add(`${f.rule_id}|${f.primary_location_line_hash}`);
  return idx;
}

export function annotateSuppressions(
  finding: Finding,
  inline: InlineSuppressions,
  ignoreFilter: IgnoreFilter | null,
  baseline: BaselineLike | null,
): Finding {
  // 1. Inline match: file + line + rule_id present in perLine map.
  const fileLineMap = inline.perLine.get(finding.file_path);
  const lineSet = fileLineMap?.get(finding.location.line);
  if (lineSet?.has(finding.rule_id)) {
    return { ...finding, suppressed: { source: "inline" } };
  }
  // 2. Ignore match: file_path matches a pattern.
  if (ignoreFilter !== null) {
    const pattern = ignoreFilter.matches(finding.file_path);
    if (pattern !== null) {
      return { ...finding, suppressed: { source: "ignore", pattern } };
    }
  }
  // 3. Baseline match: (rule_id, primary_location_line_hash) in baseline index.
  if (baseline !== null) {
    const idx = buildBaselineIndex(baseline);
    const key = `${finding.rule_id}|${finding.primary_location_line_hash}`;
    if (idx.has(key)) {
      return {
        ...finding,
        suppressed: { source: "baseline", baselined_at: baseline.baselined_at },
      };
    }
  }
  return { ...finding, suppressed: null };
}
