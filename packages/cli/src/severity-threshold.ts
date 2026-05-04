// CLI-05 fail-on threshold; D-66 suppressed-never-counts.
// Severity rank: critical < high < medium < low < info (lower number = higher severity,
// matching render/findings.ts SEVERITY_ORDER convention).

import type { Finding, Severity } from "@hookwarden/engine";

const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export function isAtOrAbove(severity: Severity, threshold: Severity): boolean {
  return SEVERITY_RANK[severity] <= SEVERITY_RANK[threshold];
}

// D-66: suppressed findings (any source) NEVER count toward the fail-on threshold.
export function countActiveAtOrAbove(
  findings: ReadonlyArray<Finding>,
  threshold: Severity,
): number {
  let n = 0;
  for (const f of findings) {
    if (f.suppressed != null) continue;
    if (isAtOrAbove(f.severity, threshold)) n += 1;
  }
  return n;
}
