// v0.7.3+ Stitch-design verbose banner — a 3-line box-drawing header that
// prefaces `hookwarden scan --verbose` output with rule-pack provenance and
// scope summary. Local-only, zero-network: the strings come from scan
// metadata + the resolved rule set, never from anywhere else.
//
// Default-mode output is unchanged; this is opt-in via --verbose to honor
// the [project_release_pipeline_fix_pkg_blocker] memory note that
// "Engine/rule-pack versions are bug-report provenance, not every-scan info"
// — chatty by default would re-introduce the noise the v0.3 cleanup removed.
//
// Pure: returns a single string. Caller (scan.ts) owns stdout.

import type { ScanMetadata } from "@hookwarden/engine";
import { dim, severityColor } from "./colors.js";

export interface RenderScanBannerInputs {
  readonly useAnsi: boolean;
  readonly metadata: ScanMetadata;
  readonly ruleCount: number;
  readonly providerCount: number;
  readonly citedCount: number;
  readonly scope: string;
  readonly handlerCount: number;
  readonly fileCount: number;
}

/**
 * Render the 3-line provenance + scope banner used by `--verbose` scans.
 * Box-drawing characters render as literal Unicode (UTF-8 terminals only;
 * the existing CLI is already UTF-8 throughout — see `colors.ts` glyphs).
 *
 * Example output (no ANSI):
 *   ╭─ hookwarden v0.7.3 · engine 0.7.3 · rules 0.7.3 (938f7565…)
 *   │  230 rules · 100% cited · 21 providers · local · zero network
 *   ╰─ scope: ./apps/webhooks · 7 handlers · 4 files
 */
export function renderScanBanner(inputs: RenderScanBannerInputs): string {
  const { useAnsi, metadata, ruleCount, providerCount, citedCount, scope, handlerCount, fileCount } =
    inputs;

  // Indigo `hookwarden vX.Y.Z` for brand anchor; everything else flows as
  // dim secondary text so the cited-coverage stat reads as a quiet boast,
  // not a hero callout. Severity colors are reused so the palette stays
  // locked — `severityColor("info", ...)` paints indigo-adjacent text.
  const accent = (s: string): string => severityColor("info", s, { useAnsi });

  // Content hash — trimmed to 8 hex chars for scan-readability. The full
  // hash lives in JSON output; readers cross-check there. Null guard for
  // the rare case the engine emits without a populated hash.
  const hashShort =
    metadata.rule_pack_content_hash !== null && metadata.rule_pack_content_hash.length >= 8
      ? `${metadata.rule_pack_content_hash.slice(0, 8)}…`
      : "—";

  // 100% case is the loud one; partial coverage gets a real ratio so users
  // can see degraded states (e.g. running against an old rule pack pre-backfill).
  const citedFraction =
    ruleCount === 0
      ? "0% cited"
      : citedCount === ruleCount
        ? "100% cited"
        : `${Math.round((citedCount / ruleCount) * 100)}% cited (${citedCount}/${ruleCount})`;

  // Build each line as `[dim box] [accent product] [dim metadata]` rather
  // than dim-wrapping the whole line — nested ANSI escapes truncate at the
  // first reset, mangling the indigo accent. Concatenation of separately
  // painted segments preserves both colors and degrades to plain text
  // cleanly under NO_COLOR / piped output.
  const handlerWord = handlerCount === 1 ? "handler" : "handlers";
  const fileWord = fileCount === 1 ? "file" : "files";

  const line1 =
    dim("╭─ ", { useAnsi }) +
    accent(`hookwarden v${metadata.rule_pack_version}`) +
    dim(
      ` · engine ${metadata.engine_version} · rules ${metadata.rule_pack_version} (${hashShort})`,
      { useAnsi },
    );
  const line2 = dim(
    `│  ${ruleCount} rules · ${citedFraction} · ${providerCount} providers · local · zero network`,
    { useAnsi },
  );
  const line3 = dim(
    `╰─ scope: ${scope} · ${handlerCount} ${handlerWord} · ${fileCount} ${fileWord}`,
    { useAnsi },
  );

  return `${line1}\n${line2}\n${line3}\n`;
}
