// D-44: 2-line footer with severity counts + scan stats from ScanMetadata.
// D-67 stale count. D-69 pre-existing count. D-70 rule-pack drift. D-72 vs <ref>. D-64 parse-coverage line.
// Pure: receives ScanResult + optional durationMs + optional Phase 4 footer fields; returns string.

import type { ScanResult, Severity } from "@hookwarden/engine";
import { dim } from "./colors.js";

export interface RenderSummaryOptions {
  readonly useAnsi: boolean;
  readonly durationMs?: number;
  // Phase 4 additions — all optional for backward compatibility with Phase 3 callers.
  readonly suppressedCount?: number;
  readonly staleCount?: number;
  readonly preExistingCount?: number;
  readonly parseCandidatesCount?: number;
  readonly parsedFilesCount?: number;
  readonly diffBase?: string | null;
  readonly rulePackDrift?: { readonly from: string; readonly to: string } | null;
  readonly verbose?: boolean;
  // Files auto-excluded by DEFAULT_TEST_GLOBS when `scan_tests` is false.
  // Surfaced as a footer hint so users know what got skipped without having
  // to re-run with --include-tests.
  readonly testExcludedCount?: number;
}

const SEVERITY_ORDER: ReadonlyArray<Severity> = ["critical", "high", "medium", "low", "info"];

function plural(n: number, singular: string, pl?: string): string {
  return `${n} ${n === 1 ? singular : (pl ?? `${singular}s`)}`;
}

export function renderSummary(result: ScanResult, opts: RenderSummaryOptions): string {
  const sevCounts: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  let manualReviewCount = 0;
  for (const f of result.findings) {
    if (f.suppressed != null) continue; // D-66: suppressed never count toward severity tally.
    sevCounts[f.severity]++;
    if (f.state === "manual-review") manualReviewCount++;
  }
  const filesTouched = new Set<string>();
  for (const h of result.inventory) filesTouched.add(h.file_path);

  const sevLine = SEVERITY_ORDER.map((s) => `${sevCounts[s]} ${s}`).join(" · ");
  const handlersLine = `${plural(result.inventory.length, "webhook handler")} across ${plural(filesTouched.size, "file")}`;

  // Line 1: severity tally · manual-review · pre-existing · suppressed · stale (use --verbose ...) — handlers
  const line1Parts: string[] = [`Found ${sevLine}`, `${manualReviewCount} manual-review`];
  if ((opts.preExistingCount ?? 0) > 0) {
    line1Parts.push(`${opts.preExistingCount} pre-existing`);
  }
  if ((opts.suppressedCount ?? 0) > 0) {
    line1Parts.push(`${opts.suppressedCount} suppressed`);
  }
  if ((opts.staleCount ?? 0) > 0) {
    line1Parts.push(`${opts.staleCount} stale`);
  }
  let line1 = line1Parts.join(" · ");
  const hiddenCount = (opts.suppressedCount ?? 0) + (opts.staleCount ?? 0);
  if (hiddenCount > 0 && opts.verbose !== true) {
    line1 += " (use --verbose to view)";
  }
  line1 += ` — ${handlersLine}`;

  const m = result.metadata;
  const line2Parts: string[] = [];
  if (opts.durationMs !== undefined) {
    line2Parts.push(`Scanned in ${(opts.durationMs / 1000).toFixed(1)} s`);
  }
  if (opts.parseCandidatesCount !== undefined && opts.parsedFilesCount !== undefined) {
    const pct =
      opts.parseCandidatesCount === 0
        ? "100.0"
        : ((opts.parsedFilesCount / opts.parseCandidatesCount) * 100).toFixed(1);
    line2Parts.push(
      `${opts.parsedFilesCount} / ${opts.parseCandidatesCount} candidates parsed (${pct}% coverage)`,
    );
  } else {
    line2Parts.push(plural(m.parse_errors_count, "parse error"));
  }
  if (opts.diffBase) {
    line2Parts.push(`vs ${opts.diffBase}`);
  }
  line2Parts.push(`engine v${m.engine_version}`, `rules v${m.rule_pack_version}`);
  let line2 = line2Parts.join(" · ");
  if (opts.rulePackDrift) {
    line2 += `\n(rule pack ${opts.rulePackDrift.from} → ${opts.rulePackDrift.to})`;
  }
  if ((opts.testExcludedCount ?? 0) > 0) {
    line2 += `\n(${opts.testExcludedCount} test/fixture file${opts.testExcludedCount === 1 ? "" : "s"} auto-excluded; use --include-tests to scan)`;
  }

  const rule = "────────────";
  return `${dim(rule, opts)}\n${line1}\n${dim(line2, opts)}\n`;
}
