// D-44: 2-line footer with severity counts + scan stats from ScanMetadata.
// Pure: receives ScanResult + optional durationMs (CLI shell measures wall-clock); returns string.

import type { ScanResult, Severity } from "@hookwarden/engine";
import { dim } from "./colors.js";

export interface RenderSummaryOptions {
  readonly useAnsi: boolean;
  readonly durationMs?: number;
}

const SEVERITY_ORDER: ReadonlyArray<Severity> = ["critical", "high", "medium", "low", "info"];

function plural(n: number, singular: string, plural?: string): string {
  return `${n} ${n === 1 ? singular : (plural ?? `${singular}s`)}`;
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
    sevCounts[f.severity]++;
    if (f.state === "manual-review") manualReviewCount++;
  }
  const filesTouched = new Set<string>();
  for (const h of result.inventory) filesTouched.add(h.file_path);

  const sevLine = SEVERITY_ORDER.map((s) => `${sevCounts[s]} ${s}`).join(" · ");
  const handlersLine = `${plural(result.inventory.length, "webhook handler")} across ${plural(filesTouched.size, "file")}`;
  const line1 = `Found ${sevLine} · ${manualReviewCount} manual-review — ${handlersLine}`;

  const m = result.metadata;
  const durText =
    opts.durationMs !== undefined ? `Scanned in ${(opts.durationMs / 1000).toFixed(1)} s · ` : "";
  const line2 = `${durText}${plural(m.parse_errors_count, "parse error")} · engine v${m.engine_version} · rules v${m.rule_pack_version}`;

  const rule = "────────────";
  return `${dim(rule, opts)}\n${line1}\n${dim(line2, opts)}\n`;
}
