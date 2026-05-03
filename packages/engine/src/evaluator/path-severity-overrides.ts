// D-57 RULES-05: post-emit severity rewriter. Pure: no fs / http / network / process / node:*.
// Engine purity guard at .dependency-cruiser.cjs lines 4–38 forbids those imports here.
//
// Matches finding.file_path against each override's glob patterns (picomatch). On the FIRST
// matching override, replaces Finding.severity. Returns the finding unchanged when:
//   - rule.path_severity_overrides is null
//   - no override has a matching pattern
//
// Verification state (Finding.state, D-29) is NEVER touched — a hardcoded test secret is still
// `not-verified`, just at `info` severity.

import picomatch from "picomatch";
import type { Finding } from "../types/finding.js";
import type { RuleDefinition } from "../types/rule-set.js";

export function applyPathSeverityOverrides(finding: Finding, rule: RuleDefinition): Finding {
  const overrides = rule.path_severity_overrides;
  if (overrides === null || overrides.length === 0) return finding;
  for (const override of overrides) {
    if (override.patterns.length === 0) continue;
    const isMatch = picomatch(override.patterns as string[], { dot: true });
    if (isMatch(finding.file_path)) {
      // Identity: do not produce a new object when severity is already the override target.
      if (finding.severity === override.severity) return finding;
      return { ...finding, severity: override.severity };
    }
  }
  return finding;
}
