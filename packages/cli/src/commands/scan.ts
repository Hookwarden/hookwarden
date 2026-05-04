// `hookwarden scan <path>` subcommand. D-46 sibling of inventory.
// CLI-04 exit codes. CLI-05 --fail-on. CLI-06 inline disable. CLI-07 ignore.
// CLI-08 --diff-only. CLI-10 --baseline. D-66 suppressed never count. D-65 exit precedence 3>2>4>1>0.
// Blocker 4: VALID_FAIL_ON / VALID_FORMAT / numeric range — gates raw CLI flag values BEFORE resolveConfig
// so nonsense values exit 3 with actionable stderr, never reach the pipeline.

import * as path from "node:path";
import type { Severity } from "@hookwarden/engine";
import { defineCommand } from "citty";
import { ConfigError, loadConfigFromCwd } from "../config/loader.js";
import { type ResolvedConfig, resolveConfig } from "../config/precedence.js";
import { computeExitCode } from "../exit-codes.js";
import { evaluateParseCoverage } from "../parse-coverage.js";
import { runScan } from "../pipeline.js";
import { renderFindings, renderJson, renderSarif, renderSummary } from "../render/index.js";
import { countActiveAtOrAbove } from "../severity-threshold.js";
import { shouldUseAnsi } from "../walker/tty.js";

export interface ScanArgs {
  readonly path?: string;
  readonly verbose?: boolean;
  readonly "no-color"?: boolean;
  readonly "rules-dir"?: string;
  // Phase 4 additions:
  readonly format?: string;
  readonly "fail-on"?: string;
  readonly baseline?: string;
  readonly "no-baseline"?: boolean;
  readonly "diff-only"?: boolean;
  readonly "diff-base"?: string;
  readonly config?: string;
  readonly "no-config"?: boolean;
  readonly "strict-suppressions"?: boolean;
  readonly "min-parse-coverage"?: string;
}

const VALID_FAIL_ON: ReadonlySet<string> = new Set(["critical", "high", "medium", "low"]);
const VALID_FORMAT: ReadonlySet<string> = new Set(["text", "json", "sarif"]);

export async function runScanCommand(args: ScanArgs): Promise<number> {
  const cwd = path.resolve(args.path ?? ".");
  const noColor = args["no-color"] === true;
  const useAnsi = noColor ? false : shouldUseAnsi(process.stdout);
  const verbose = args.verbose === true;

  // Step 0 — Blocker 4: VALUE validation gate runs BEFORE resolveConfig / before the pipeline.
  // Per D-65, malformed CLI input is a CONFIG ERROR (exit 3), not an engine error (exit 2).
  if (args["fail-on"] !== undefined && !VALID_FAIL_ON.has(args["fail-on"])) {
    process.stderr.write(
      `error: --fail-on must be one of critical|high|medium|low (got "${args["fail-on"]}")\n`,
    );
    return 3;
  }
  if (args.format !== undefined && !VALID_FORMAT.has(args.format)) {
    process.stderr.write(`error: --format must be one of text|json|sarif (got "${args.format}")\n`);
    return 3;
  }
  let parsedMinCoverage: number | undefined;
  if (args["min-parse-coverage"] !== undefined) {
    parsedMinCoverage = Number(args["min-parse-coverage"]);
    if (!Number.isFinite(parsedMinCoverage) || parsedMinCoverage < 0 || parsedMinCoverage > 1) {
      process.stderr.write(
        `error: --min-parse-coverage must be a number between 0 and 1 (got "${args["min-parse-coverage"]}")\n`,
      );
      return 3;
    }
  }

  // Step 1 — Config-file discovery (Plan 02). --no-config bypasses; --config <path> overrides walk-up.
  let fileConfig = null;
  try {
    const explicitPath = args.config;
    const loaded = await loadConfigFromCwd({
      cwd,
      ...(explicitPath !== undefined ? { explicitPath } : {}),
      disabled: args["no-config"] === true,
    });
    fileConfig = loaded.config;
  } catch (e) {
    if (e instanceof ConfigError) {
      process.stderr.write(`error: ${e.message}\n`);
    } else {
      process.stderr.write(`error: config-file load failed: ${(e as Error).message}\n`);
    }
    return 3;
  }

  // Step 2 — CLI-flag → Partial<ResolvedConfig>. Values pre-validated in Step 0.
  const cliFlags: Partial<ResolvedConfig> = {
    ...(args.format !== undefined ? { format: args.format as ResolvedConfig["format"] } : {}),
    ...(args["fail-on"] !== undefined ? { fail_on: args["fail-on"] as Severity } : {}),
    ...(parsedMinCoverage !== undefined ? { parse_coverage_min: parsedMinCoverage } : {}),
    ...(args["strict-suppressions"] === true ? { suppressions_strict: true } : {}),
    ...(args["no-baseline"] === true ? { baseline_enabled: false } : {}),
    ...(args["diff-base"] !== undefined ? { diff_base: args["diff-base"] } : {}),
    ...(args["rules-dir"] !== undefined ? { rules_dir: args["rules-dir"] } : {}),
  };

  // Step 3 — Resolve via precedence (Plan 02). Env-var validation happens inside resolveConfig.
  let resolvedConfig: ResolvedConfig;
  try {
    resolvedConfig = resolveConfig(cliFlags, process.env, fileConfig);
  } catch (e) {
    process.stderr.write(`error: config validation failed: ${(e as Error).message}\n`);
    return 3;
  }

  // Step 4 — Run the pipeline (Task 1).
  const baselineWrite = args.baseline === "write";
  const diffOnly = args["diff-only"] === true;
  const scan = await runScan({
    rootPath: cwd,
    resolvedConfig,
    diffOnly,
    diffBase: args["diff-base"] ?? null,
    baselineWrite,
    verbose,
  });

  if (scan.engineError !== null) {
    process.stderr.write(`engine error: ${scan.engineError.message}\n`);
    return 2;
  }

  // Step 5 — Parse-coverage gate (Plan 06).
  const coverage = evaluateParseCoverage(scan.result.metadata, resolvedConfig.parse_coverage_min);
  if (coverage.belowMin && coverage.message !== null) {
    process.stderr.write(`${coverage.message}\n`);
  }

  // Step 6 — Format dispatch.
  switch (resolvedConfig.format) {
    case "text":
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
      break;
    case "json":
      process.stdout.write(
        renderJson({
          scanResult: scan.result,
          ruleSet: scan.ruleSet,
          stale: scan.stale,
        }),
      );
      break;
    case "sarif":
      process.stdout.write(
        renderSarif({
          scanResult: scan.result,
          ruleSet: scan.ruleSet,
          stale: scan.stale,
        }),
      );
      break;
    default:
      process.stderr.write(
        `error: unknown format '${resolvedConfig.format}' — supported: text | json | sarif\n`,
      );
      return 3;
  }

  // Step 7 — Exit-code computation (D-65 precedence: 3 > 2 > 4 > 1 > 0; config + engine already returned earlier).
  const findingsAtThreshold =
    countActiveAtOrAbove(scan.result.findings, resolvedConfig.fail_on) > 0;
  const staleAsError = resolvedConfig.suppressions_strict && scan.stale.length > 0;
  if (staleAsError) {
    process.stderr.write(
      `error: ${scan.stale.length} stale suppression(s) detected (--strict-suppressions)\n`,
    );
  }
  return computeExitCode({
    configError: false,
    engineError: false,
    belowParseCoverage: coverage.belowMin,
    findingsAtThreshold: findingsAtThreshold || staleAsError,
  });
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
    format: { type: "string", description: "Output format: text | json | sarif" },
    "fail-on": {
      type: "string",
      description: "Severity threshold: critical | high | medium | low",
    },
    baseline: { type: "string", description: "'write' to capture; auto-read otherwise" },
    "no-baseline": { type: "boolean", description: "Disable baseline reading" },
    "diff-only": {
      type: "boolean",
      description: "Scan only files changed vs base ref (CLI-08)",
    },
    "diff-base": { type: "string", description: "Override auto-detected base ref" },
    config: {
      type: "string",
      description: "Path to hookwarden.config.yaml (overrides walk-up discovery)",
    },
    "no-config": { type: "boolean", description: "Bypass config-file discovery" },
    "strict-suppressions": {
      type: "boolean",
      description: "Promote stale suppressions to errors (D-67)",
    },
    "min-parse-coverage": {
      type: "string",
      description: "Minimum parse-coverage ratio 0..1 (default 0.95)",
    },
  },
  run: async ({ args }) => runScanCommand(args as ScanArgs),
});
