// `hookwarden scan <path>` subcommand. D-46 sibling of inventory.
// CLI-04 exit codes. CLI-05 --fail-on. CLI-06 inline disable. CLI-07 ignore.
// CLI-08 --diff-only. CLI-10 --baseline. D-66 suppressed never count. D-65 exit precedence 3>2>4>1>0.
// Blocker 4: VALID_FAIL_ON / VALID_FORMAT / numeric range — gates raw CLI flag values BEFORE resolveConfig
// so nonsense values exit 3 with actionable stderr, never reach the pipeline.

import * as path from "node:path";
import type { Severity } from "@hookwarden/engine";
import { PROVIDER_CATALOG } from "@hookwarden/rules";
import { defineCommand } from "citty";
import { ConfigError, loadConfigFromCwd } from "../config/loader.js";
import { type ResolvedConfig, resolveConfig } from "../config/precedence.js";
import { computeExitCode } from "../exit-codes.js";
import { evaluateParseCoverage } from "../parse-coverage.js";
import { runScan } from "../pipeline.js";
import { dim } from "../render/colors.js";
import {
  renderFindings,
  renderInventory,
  renderJson,
  renderSarif,
  renderSummary,
} from "../render/index.js";
import { countActiveAtOrAbove } from "../severity-threshold.js";
import { shouldUseAnsi } from "../walker/tty.js";

export interface ScanArgs {
  readonly path?: string;
  readonly verbose?: boolean;
  readonly "no-color"?: boolean;
  readonly color?: string;
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
  readonly "include-tests"?: boolean;
  readonly provider?: string;
  readonly exclude?: string;
  readonly include?: string;
}

const VALID_FAIL_ON: ReadonlySet<string> = new Set(["critical", "high", "medium", "low"]);
const VALID_FORMAT: ReadonlySet<string> = new Set(["text", "json", "sarif"]);
const VALID_PROVIDERS: ReadonlySet<string> = new Set(Object.keys(PROVIDER_CATALOG));

export async function runScanCommand(args: ScanArgs): Promise<number> {
  const cwd = path.resolve(args.path ?? ".");
  // Color resolution precedence: --color always|never  >  --no-color  >
  // FORCE_COLOR env  >  TTY/NO_COLOR/CI auto-detection. `--color always` lets
  // you force the palette through a pipe or recorder; `auto` (default) keeps
  // CI logs and redirected output clean.
  const noColor = args["no-color"] === true;
  const colorMode = args.color;
  const forceColorEnv = process.env["FORCE_COLOR"];
  const forceColor = forceColorEnv !== undefined && forceColorEnv !== "" && forceColorEnv !== "0";
  let useAnsi: boolean;
  if (colorMode === "always") useAnsi = true;
  else if (colorMode === "never" || noColor) useAnsi = false;
  else if (forceColor) useAnsi = true;
  else useAnsi = shouldUseAnsi(process.stdout);
  const verbose = args.verbose === true;

  // Phase 8.2 D-16: `hookwarden scan --fix` is rejected. Auto-fix lives in the
  // `hookwarden fix` subcommand. Conflating scan (read) + fix (write) is the
  // failure mode that produces data loss; the explicit subcommand split is the
  // safety boundary.
  if ((args as unknown as { fix?: unknown }).fix !== undefined) {
    process.stderr.write(
      "error: --fix is not a scan flag. Use 'hookwarden fix [<path>]' to apply fixes.\n" +
        "       Run 'hookwarden scan' then 'hookwarden fix' for explicit separation.\n",
    );
    return 3;
  }

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
  let providerFilter: ReadonlySet<string> | null = null;
  if (args.provider !== undefined && args.provider.trim() !== "") {
    const raw = args.provider
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const invalid = raw.filter((p) => !VALID_PROVIDERS.has(p));
    if (invalid.length > 0) {
      process.stderr.write(
        `error: --provider unknown value(s): ${invalid.join(", ")}. Valid: ${[...VALID_PROVIDERS].sort().join(", ")}\n`,
      );
      return 3;
    }
    providerFilter = new Set(raw);
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
    ...(args["include-tests"] === true ? { scan_tests: true } : {}),
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
    providerFilter,
    excludeGlobs:
      args.exclude !== undefined && args.exclude.trim() !== ""
        ? args.exclude
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s !== "")
        : [],
    includeGlobs:
      args.include !== undefined && args.include.trim() !== ""
        ? args.include
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s !== "")
        : [],
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
      // --verbose shows its work: every webhook handler the scan found (with
      // its provider/framework/verdict) before the findings detail below.
      if (verbose && scan.result.inventory.length > 0) {
        process.stdout.write(
          `${dim(`Handlers scanned — ${scan.result.inventory.length}`, { useAnsi })}\n`,
        );
        process.stdout.write(renderInventory(scan.result, { useAnsi, cwd }));
        process.stdout.write("\n");
      }
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
          testExcludedCount: scan.walkResult.test_excluded_count,
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
    color: {
      type: "string",
      description:
        "When to colorize: always | never | auto (default). Use 'always' to force color through a pipe.",
    },
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
    "include-tests": {
      type: "boolean",
      description:
        "Scan test/fixture/mock paths too. Excluded by default — production routes rarely live in test/, tests/, __tests__/, spec/, fixtures/, mocks/, *.test.*, *.spec.*, test_*.py, *_test.py.",
    },
    provider: {
      type: "string",
      description:
        "Comma-separated provider filter (e.g., 'stripe' or 'stripe,github'). When set, only rules for the listed providers run — useful for phased rollout. Valid: stripe, github, shopify, slack, twilio, square.",
    },
    exclude: {
      type: "string",
      description:
        "Comma-separated gitignore-style globs to exclude from the scan (e.g., 'packages/legacy/**,vendor/**'). Applied on top of .gitignore + default test-fixture exclusions.",
    },
    include: {
      type: "string",
      description:
        "Comma-separated gitignore-style globs to scope the scan to (e.g., 'packages/api/**'). When set, only matching files are scanned.",
    },
  },
  run: async ({ args }) => runScanCommand(args as ScanArgs),
});
