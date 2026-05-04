// `hookwarden scan <path>` subcommand. D-46 sibling of inventory.

import { defineCommand } from "citty";
import { CONFIG_DEFAULTS } from "../config/precedence.js";
import { runScan } from "../pipeline.js";
import { renderFindings, renderSummary } from "../render/index.js";
import { shouldUseAnsi } from "../walker/tty.js";

export interface ScanArgs {
  readonly path?: string;
  readonly verbose?: boolean;
  readonly "no-color"?: boolean;
  readonly "rules-dir"?: string;
}

// Phase 4 Task 2 will replace this with full citty wiring + Blocker 4 validation gate.
// This stub keeps the public API working until that lands.
export async function runScanCommand(args: ScanArgs): Promise<number> {
  const rootPath = args.path ?? ".";
  const noColor = args["no-color"] === true;
  const useAnsi = noColor ? false : shouldUseAnsi(process.stdout);
  const cwd = process.cwd();
  const verbose = args.verbose === true;

  const resolvedConfig =
    args["rules-dir"] !== undefined
      ? { ...CONFIG_DEFAULTS, rules_dir: args["rules-dir"] }
      : CONFIG_DEFAULTS;
  const scan = await runScan({
    rootPath,
    resolvedConfig,
    diffOnly: false,
    diffBase: null,
    baselineWrite: false,
    verbose,
  });

  process.stdout.write(renderFindings(scan.result, scan.ruleSet, { useAnsi, cwd }));
  process.stdout.write(
    renderSummary(scan.result, {
      useAnsi,
      durationMs: scan.durationMs,
      suppressedCount: scan.suppressedCount,
      staleCount: scan.stale.length,
      preExistingCount: scan.preExistingCount,
      parseCandidatesCount: scan.result.metadata.parse_candidates_count,
      parsedFilesCount: scan.result.metadata.parsed_files_count,
      diffBase: scan.diffBase,
      rulePackDrift: scan.rulePackDrift,
      verbose,
    }),
  );

  return scan.result.findings.length === 0 ? 0 : 1;
}

export const scanCommand = defineCommand({
  meta: {
    name: "scan",
    description: "Scan a project for webhook signature-verification bugs.",
  },
  args: {
    path: {
      type: "positional",
      required: false,
      description: "Project root (default: .)",
      default: ".",
    },
    verbose: { type: "boolean", alias: "v", description: "Verbose output." },
    "no-color": { type: "boolean", description: "Disable color and OSC-8 hyperlinks." },
    "rules-dir": {
      type: "string",
      description: "Override the bundled rule pack location (dev-only).",
    },
  },
  run: async ({ args }) => runScanCommand(args as ScanArgs),
});
