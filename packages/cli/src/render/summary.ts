// D-44: 2-line footer with severity counts + scan stats from ScanMetadata.
// D-67 stale count. D-69 pre-existing count. D-70 rule-pack drift. D-72 vs <ref>. D-64 parse-coverage line.
// Pure: receives ScanResult + optional durationMs + optional Phase 4 footer fields; returns string.

import type { ScanResult, Severity, Verdict } from "@hookwarden/engine";
import { dim, severityColor, verdictColor } from "./colors.js";

const VERDICT_ORDER: ReadonlyArray<Verdict> = ["verified", "not-verified", "manual-review"];

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
  // v0.7.3 Stitch verbose-mode addition: emit a separate 3-state verdict
  // tally row + exit-code annotation below the existing severity line.
  // Only fires when verbose is true AND there are findings to tally.
  readonly exitCode?: number;
  readonly failOn?: string;
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

  // D-42: severity drives color. Paint each tally segment in its severity colour so the
  // footer count matches the per-finding glyphs (critical=red, high=orange, medium=amber,
  // low=slate, info=blue) instead of rendering the whole tally in plain foreground.
  const sevLine = SEVERITY_ORDER.map((s) => severityColor(s, `${sevCounts[s]} ${s}`, opts)).join(
    " · ",
  );
  const handlersLine = `${plural(result.inventory.length, "webhook handler")} across ${plural(filesTouched.size, "file")}`;
  const totalFindings = SEVERITY_ORDER.reduce((n, s) => n + sevCounts[s], 0);

  // Line 1. A clean scan skips the all-zeros severity tally — a row of zeros
  // tells the reader nothing; just state the scope that was covered.
  // Filtered-out tallies (still meaningful even when 0 active findings remain).
  const extraSegments: string[] = [];
  if ((opts.preExistingCount ?? 0) > 0) extraSegments.push(`${opts.preExistingCount} pre-existing`);
  if ((opts.suppressedCount ?? 0) > 0) extraSegments.push(`${opts.suppressedCount} suppressed`);
  if ((opts.staleCount ?? 0) > 0) extraSegments.push(`${opts.staleCount} stale`);
  const hiddenCount = (opts.suppressedCount ?? 0) + (opts.staleCount ?? 0);

  let line1: string;
  if (totalFindings === 0 && extraSegments.length === 0) {
    // Truly clean: no severity zeros to print, just the scope covered.
    line1 = handlersLine;
  } else {
    // Drop the all-zeros severity tally when there are no active findings;
    // otherwise lead with it. Filtered-out segments always follow.
    const line1Parts: string[] =
      totalFindings > 0 ? [`Found ${sevLine}`, `${manualReviewCount} manual-review`] : [];
    line1Parts.push(...extraSegments);
    line1 = line1Parts.join(" · ");
    if (hiddenCount > 0 && opts.verbose !== true) {
      line1 += " (use --verbose to view)";
    }
    line1 += ` — ${handlersLine}`;
  }

  const m = result.metadata;
  const line2Parts: string[] = [];
  if (opts.durationMs !== undefined) {
    // Sub-second scans rendered as "0.0 s" looked broken; show ms under 1s.
    const ms = opts.durationMs;
    const elapsed = ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
    line2Parts.push(`Scanned in ${elapsed}`);
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
  // Engine/rule-pack versions are bug-report provenance, not every-scan info —
  // only surface them under --verbose to keep the default footer quiet.
  if (opts.verbose === true) {
    line2Parts.push(`engine v${m.engine_version}`, `rules v${m.rule_pack_version}`);
  }
  let line2 = line2Parts.join(" · ");
  if (opts.rulePackDrift) {
    line2 += `\n(rule pack ${opts.rulePackDrift.from} → ${opts.rulePackDrift.to})`;
  }
  if ((opts.testExcludedCount ?? 0) > 0) {
    line2 += `\n(${opts.testExcludedCount} test/fixture file${opts.testExcludedCount === 1 ? "" : "s"} auto-excluded; use --include-tests to scan)`;
  }

  // Severity + state legends: render one line per tier with a finding in
  // this report, so readers don't have to guess what each label implies.
  // Each line is short ("X = ...") and accent-prefixed via dim() so the
  // legend block is visually distinct from the scan stats above.
  //
  // Suppressed on a clean scan — adding a legend block to "0 findings"
  // output would be pure noise.
  const legendLines: string[] = [];
  if (sevCounts.critical > 0) {
    legendLines.push(
      "critical = concrete vulnerability (missing sig verification, raw body misuse, hardcoded secret). Fails the build at default threshold.",
    );
  }
  if (sevCounts.high > 0) {
    legendLines.push(
      "high = exploitable verification weakness (timing-unsafe compare, missing timestamp/replay defense, wrong HMAC algorithm).",
    );
  }
  if (sevCounts.medium > 0) {
    legendLines.push("medium = secondary-defense or hygiene issue worth fixing before audit.");
  }
  if (sevCounts.info > 0) {
    legendLines.push(
      "info = positive signal — handler is correctly using an SDK verify path (no action needed).",
    );
  }
  if (manualReviewCount > 0) {
    legendLines.push(
      "manual-review = engine can't prove safe/unsafe; surfaced for human review and does not fail the build by default (use --fail-on low to gate).",
    );
  }
  if (legendLines.length > 0) {
    line2 += `\n${legendLines.join("\n")}`;
  }

  const rule = "────────────";

  // v0.7.3 Stitch verbose-mode addition: a separate 3-state verdict tally
  // row + exit-code annotation below the severity line. The severity row
  // ("X critical · Y high · …") tells you the BLAST RADIUS; the verdict
  // row tells you the CONFIDENCE distribution (how many are statically
  // proven not-verified vs. flagged for human review). Two complementary
  // axes — surfacing both in verbose mode is a real signal, not noise.
  let verdictLine = "";
  let exitLine = "";
  if (opts.verbose === true && totalFindings > 0) {
    const verdictCounts: Record<Verdict, number> = {
      verified: 0,
      "not-verified": 0,
      "manual-review": 0,
    };
    for (const f of result.findings) {
      if (f.suppressed != null) continue;
      verdictCounts[f.state] += 1;
    }
    verdictLine = VERDICT_ORDER.map((v) => verdictColor(v, `${verdictCounts[v]} ${v}`, opts)).join(
      " · ",
    );
    if (opts.exitCode !== undefined) {
      const code = opts.exitCode;
      const gate = opts.failOn !== undefined ? ` (fail-on=${opts.failOn})` : "";
      const codePainted =
        code === 0
          ? severityColor("info", `Exit: ${code}`, opts)
          : severityColor("critical", `Exit: ${code}`, opts);
      exitLine = `${codePainted}${dim(gate, opts)}`;
    }
  }

  const base = `${dim(rule, opts)}\n${line1}\n${dim(line2, opts)}\n`;
  if (verdictLine === "" && exitLine === "") return base;
  const extras: string[] = [];
  if (verdictLine !== "") extras.push(verdictLine);
  if (exitLine !== "") extras.push(exitLine);
  return `${base}${extras.join("\n")}\n`;
}
