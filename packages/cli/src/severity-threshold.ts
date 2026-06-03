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

// Whether a single finding counts toward the fail-on gate, given its 3-state verdict.
// The gate is state-aware so exit-code behavior matches the documented summary legend:
//   - verified     → positive signal (handler IS verifying correctly). NEVER gates, at any
//                     threshold — failing a build because a handler is correct is nonsensical.
//   - manual-review → engine can't prove safe/unsafe. "does not fail the build by default
//                     (use --fail-on low to gate)" — so it only counts when the threshold is
//                     `low` or `info` (rank >= low).
//   - not-verified  → confirmed-missing/unsafe verification. Always counts, subject to severity.
//
// EXCEPTION: engine/parse-error findings carry state "manual-review" (the engine can't say
// verified/not-verified about a file it can't parse), but they are NOT a 3-state verification
// verdict — an unparseable file is a scan blind spot that MUST gate by severity (contract:
// summary.ts surfaces "counts toward --fail-on high"). The renderer already treats parse-error as
// a distinct category; the gate does too. Without this, a webhook handler hidden in an unparseable
// file silently stops failing CI at the default threshold whenever overall parse coverage holds.
function findingGatesAtThreshold(f: Finding, threshold: Severity): boolean {
  if (f.state === "verified") return false;
  const isParseError = f.rule_id === "engine/parse-error";
  if (!isParseError && f.state === "manual-review" && SEVERITY_RANK[threshold] < SEVERITY_RANK.low) {
    return false;
  }
  return isAtOrAbove(f.severity, threshold);
}

// D-66: suppressed findings (any source) NEVER count toward the fail-on threshold.
export function countActiveAtOrAbove(
  findings: ReadonlyArray<Finding>,
  threshold: Severity,
): number {
  let n = 0;
  for (const f of findings) {
    if (f.suppressed != null) continue;
    if (findingGatesAtThreshold(f, threshold)) n += 1;
  }
  return n;
}
