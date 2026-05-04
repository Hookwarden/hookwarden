// D-64 denominator parse_candidates_count (extension-allowlisted), NOT total_files_count.
// D-65 default min 0.95 + stderr message format. min=0 disables the gate.

import type { ScanMetadata } from "@hookwarden/engine";

export interface ParseCoverageResult {
  readonly ratio: number;
  readonly belowMin: boolean;
  readonly message: string | null;
  readonly parsed: number;
  readonly candidates: number;
}

export function evaluateParseCoverage(
  meta: ScanMetadata,
  minCoverage: number,
): ParseCoverageResult {
  const candidates = meta.parse_candidates_count;
  const parsed = meta.parsed_files_count;

  if (candidates === 0) {
    return { ratio: 1, belowMin: false, message: null, parsed, candidates };
  }

  const ratio = parsed / candidates;

  if (minCoverage <= 0) {
    return { ratio, belowMin: false, message: null, parsed, candidates };
  }

  if (ratio < minCoverage) {
    const pct = (ratio * 100).toFixed(1);
    const minPct = (minCoverage * 100).toFixed(1);
    const unparseable = candidates - parsed;
    return {
      ratio,
      belowMin: true,
      message: `Parse coverage ${pct}% below minimum ${minPct}% (${unparseable} files unparseable). Likely toolchain mismatch.`,
      parsed,
      candidates,
    };
  }

  return { ratio, belowMin: false, message: null, parsed, candidates };
}
