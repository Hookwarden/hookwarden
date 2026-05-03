// D-67 stale detection: entries that matched zero findings.
// Performance: pattern-usage index built ONCE in O(P × F). Naïve per-pattern-per-finding
// loop O(P² × F) is forbidden — pre-computed Map is the contract.
// Attribution: every positive ignore pattern that matches a finding's file_path is counted
// (matchesAll), so earlier overlapping patterns are not lost.

import type { Finding } from "@hookwarden/engine";
import type { IgnoreFilter } from "./ignore-file.js";
import type { InlineSuppressions } from "./inline-comments.js";
import type { BaselineLike } from "./merge.js";

export interface StaleSuppression {
  readonly source: "inline" | "ignore" | "baseline";
  readonly pattern?: string;
  readonly rule_id?: string;
  readonly file_path?: string;
  readonly line?: number;
}

export function detectStale(
  findings: ReadonlyArray<Finding>,
  inline: InlineSuppressions,
  ignoreFilter: IgnoreFilter | null,
  baseline: BaselineLike | null,
): ReadonlyArray<StaleSuppression> {
  const stale: StaleSuppression[] = [];

  // 1. Inline entries: did any finding's (file, line, rule) match this entry?
  // Pre-build a set over all findings ONCE in O(F); each entry then checks in O(1).
  const findingsKeyIndex = new Set<string>();
  for (const f of findings) {
    findingsKeyIndex.add(`${f.file_path}|${f.location.line}|${f.rule_id}`);
  }
  for (const entry of inline.entries) {
    const matched = entry.rule_ids.some((rid) =>
      findingsKeyIndex.has(`${entry.file_path}|${entry.line}|${rid}`),
    );
    if (!matched) {
      const firstRule = entry.rule_ids[0];
      const inlineEntry: StaleSuppression =
        firstRule !== undefined
          ? {
              source: "inline",
              file_path: entry.file_path,
              line: entry.comment_line,
              rule_id: firstRule,
            }
          : {
              source: "inline",
              file_path: entry.file_path,
              line: entry.comment_line,
            };
      stale.push(inlineEntry);
    }
  }

  // 2. Ignore patterns: pre-compute a pattern-usage Map in O(P × F) using matchesAll
  //    so EVERY pattern that matches a file gets credit. Naïve nested loop is forbidden.
  if (ignoreFilter !== null) {
    const patternUsage = new Map<string, number>();
    for (const f of findings) {
      const matchedPatterns = ignoreFilter.matchesAll(f.file_path);
      for (const p of matchedPatterns) {
        patternUsage.set(p, (patternUsage.get(p) ?? 0) + 1);
      }
    }
    for (const p of ignoreFilter.patterns) {
      if (p.startsWith("!")) continue; // negations are modifiers, not entries
      if ((patternUsage.get(p) ?? 0) === 0) {
        stale.push({ source: "ignore", pattern: p });
      }
    }
  }

  // 3. Baseline entries: did any current finding match (rule_id, primary_location_line_hash)?
  if (baseline !== null) {
    const currentKeys = new Set<string>();
    for (const f of findings) {
      currentKeys.add(`${f.rule_id}|${f.primary_location_line_hash}`);
    }
    for (const b of baseline.findings) {
      const key = `${b.rule_id}|${b.primary_location_line_hash}`;
      if (!currentKeys.has(key)) {
        stale.push({
          source: "baseline",
          rule_id: b.rule_id,
        });
      }
    }
  }

  return stale;
}
