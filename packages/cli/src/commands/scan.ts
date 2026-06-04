// `hookwarden scan <path>` subcommand. D-46 sibling of inventory.
// CLI-04 exit codes. CLI-05 --fail-on. CLI-06 inline disable. CLI-07 ignore.
// CLI-08 --diff-only. CLI-10 --baseline. D-66 suppressed never count. D-65 exit precedence 3>2>4>1>0.
// Blocker 4: VALID_FAIL_ON / VALID_FORMAT / numeric range — gates raw CLI flag values BEFORE resolveConfig
// so nonsense values exit 3 with actionable stderr, never reach the pipeline.

import { statSync } from "node:fs";
import * as path from "node:path";
import type { Severity } from "@hookwarden/engine";
import { PROVIDER_CATALOG, SEVERITY_CLASS_GROUP_NAMES } from "@hookwarden/rules";
import { defineCommand } from "citty";
import { ConfigError, loadConfigFromCwd } from "../config/loader.js";
import { type ResolvedConfig, resolveConfig } from "../config/precedence.js";
import { GitNotInWorkTreeError } from "../diff/git.js";
import { computeExitCode } from "../exit-codes.js";
import { runHistoryScan } from "../history/walk.js";
import { evaluateParseCoverage } from "../parse-coverage.js";
import { type RunScanOutput, runScan } from "../pipeline.js";
import { dim } from "../render/colors.js";
import {
  renderFindings,
  renderInventory,
  renderJson,
  renderSarif,
  renderScanBanner,
  renderSummary,
} from "../render/index.js";
import { countActiveAtOrAbove } from "../severity-threshold.js";
import { shouldDisableTrivia, startTriviaTicker } from "../trivia.js";
import { maybeRenderUpdateBanner, runUpdateCheck } from "../update-check.js";
import { VERSION } from "../version.js";
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
  // Phase 28 LEAK-05 — git-history walk (OSS, ungated).
  readonly history?: boolean;
  readonly since?: string;
  readonly config?: string;
  readonly "no-config"?: boolean;
  readonly "strict-suppressions"?: boolean;
  readonly "min-parse-coverage"?: string;
  readonly "include-tests"?: boolean;
  readonly provider?: string;
  readonly "severity-class"?: string;
  readonly exclude?: string;
  readonly include?: string;
  readonly "no-trivia"?: boolean;
  readonly "no-update-notifier"?: boolean;
}

const VALID_FAIL_ON: ReadonlySet<string> = new Set(["critical", "high", "medium", "low"]);
const VALID_FORMAT: ReadonlySet<string> = new Set(["text", "json", "sarif"]);
const VALID_PROVIDERS: ReadonlySet<string> = new Set(Object.keys(PROVIDER_CATALOG));
const VALID_SEVERITY_CLASSES: ReadonlySet<string> = new Set(SEVERITY_CLASS_GROUP_NAMES);

export async function runScanCommand(args: ScanArgs): Promise<number> {
  const cwd = path.resolve(args.path ?? ".");
  // Directory context for config walk-up + file:line hyperlink rendering. The
  // pipeline walks `cwd` (file or dir) directly, but anything resolved RELATIVE
  // to the scan root — config discovery, and the OSC-8 links built from
  // repo-relative file_paths — must anchor to the file's PARENT when the target
  // is a single file, mirroring runScan's own file→dirname split. Without this,
  // `hookwarden scan ./app/src/stripe.js` renders the link as
  // file://…/stripe.js/stripe.js:3:1 (the basename doubled), since the renderer
  // does path.resolve(cwd, file_path) and file_path is the basename relative to
  // the file's dir. nonexistent paths fall through unchanged — the pipeline
  // reports them.
  // `scan` is a CI security gate: a nonexistent / unreadable / non-file-or-dir target must FAIL
  // LOUDLY, never silently succeed. Previously a typo'd path (`hookwarden scan ./scr`) walked an
  // empty tree → 0 candidates → "100% coverage" → exit 0 "No findings" — false all-clear, the
  // worst failure mode for a security tool. (Note: `inventory`, a listing command, deliberately
  // stays graceful on a missing path — docker-smoke 5.10 — so this hard-fail lives in `scan` only.)
  let baseDir = cwd;
  try {
    const targetStat = statSync(cwd); // follows symlinks — a link to a real file/dir is valid
    if (targetStat.isFile()) baseDir = path.dirname(cwd);
    else if (!targetStat.isDirectory()) {
      process.stderr.write(`error: cannot scan '${args.path ?? "."}': not a file or directory\n`);
      return 3;
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    const reason = code === "ENOENT" ? "no such file or directory" : (e as Error).message;
    process.stderr.write(`error: cannot scan '${args.path ?? "."}': ${reason}\n`);
    return 3;
  }
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
  let severityClassGroup: string | null = null;
  if (args["severity-class"] !== undefined && args["severity-class"].trim() !== "") {
    const requested = args["severity-class"].trim();
    if (!VALID_SEVERITY_CLASSES.has(requested)) {
      process.stderr.write(
        `error: --severity-class must be one of ${[...VALID_SEVERITY_CLASSES].sort().join(", ")} (got "${requested}")\n`,
      );
      return 3;
    }
    severityClassGroup = requested;
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

  // Phase 28 — --history / --since value gates (exit 3 on bad input, before the pipeline).
  if (args.since !== undefined && args.since.trim() === "") {
    process.stderr.write("error: --since requires a non-empty git ref or date\n");
    return 3;
  }
  if (args.since !== undefined && args.history !== true) {
    process.stderr.write("error: --since requires --history\n");
    return 3;
  }

  // Step 1 — Config-file discovery (Plan 02). --no-config bypasses; --config <path> overrides walk-up.
  let fileConfig = null;
  try {
    const explicitPath = args.config;
    const loaded = await loadConfigFromCwd({
      cwd: baseDir,
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

  // v0.7.3 trivia ticker — rotating webhook-security tips on stderr during
  // long scans. TTY-gated, opt-out via --no-trivia, never fires in CI or
  // when stderr is piped. Zero-network: every tip is a local string.
  // Only meaningful for text-format scans; JSON/SARIF callers pipe stdout
  // and we don't want stray stderr in their machine-consumed output either,
  // but the TTY check (isTTY on stderr) catches that automatically.
  const stopTrivia = startTriviaTicker({
    disabled: shouldDisableTrivia(args["no-trivia"] === true ? { noTrivia: true } : {}),
  });

  // v0.7.4 update-availability check — non-blocking background fetch of
  // npm's latest hookwarden version. Result rendered post-scan if (a) a
  // newer version landed AND (b) TTY/text-format gates pass. Auto-skipped
  // in CI / NO_COLOR via update-notifier's own checks; explicitly skipped
  // by --no-update-notifier (consumed by update-notifier directly from
  // process.argv). The check is a network call but is scoped to npm
  // registry only — never touches user code, never sees scan data.
  const updateNotifier = runUpdateCheck({
    pkg: { name: "hookwarden", version: VERSION },
    disabled: args["no-update-notifier"] === true,
  });

  const excludeGlobs =
    args.exclude !== undefined && args.exclude.trim() !== ""
      ? args.exclude
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s !== "")
      : [];
  const includeGlobs =
    args.include !== undefined && args.include.trim() !== ""
      ? args.include
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s !== "")
      : [];

  // Phase 28 — --history dispatches to the git-history walk (deleted-inclusive blob scan).
  // OSS + ungated; a non-empty --since is already validated above. A git failure (not a work
  // tree, or a rev-list-rejected range) is a config-class error → exit 3.
  let scan: RunScanOutput;
  if (args.history === true) {
    try {
      scan = await runHistoryScan({
        rootPath: cwd,
        resolvedConfig,
        since: args.since ?? null,
        defaultN: 1000,
        verbose,
        providerFilter,
        severityClassGroup,
        excludeGlobs,
        includeGlobs,
      });
    } catch (e) {
      stopTrivia();
      if (e instanceof GitNotInWorkTreeError) {
        process.stderr.write("error: --history requires a git working tree\n");
      } else {
        process.stderr.write(`error: --history walk failed: ${(e as Error).message}\n`);
      }
      return 3;
    }
  } else {
    scan = await runScan({
      rootPath: cwd,
      resolvedConfig,
      diffOnly,
      diffBase: args["diff-base"] ?? null,
      baselineWrite,
      verbose,
      providerFilter,
      severityClassGroup,
      excludeGlobs,
      includeGlobs,
    });
  }

  // Stop the trivia ticker before any further stderr/stdout output so
  // the next caller's line starts clean (the stop() also clears via
  // `\r\x1b[K`). Guaranteed to run on every code path below.
  stopTrivia();

  if (scan.engineError !== null) {
    process.stderr.write(`engine error: ${scan.engineError.message}\n`);
    return 2;
  }

  // Step 5 — Parse-coverage gate (Plan 06).
  const coverage = evaluateParseCoverage(scan.result.metadata, resolvedConfig.parse_coverage_min);
  if (coverage.belowMin && coverage.message !== null) {
    process.stderr.write(`${coverage.message}\n`);
  }

  // Step 6.0 — Pre-compute exit code so verbose summary can annotate it
  // BEFORE rendering. The same computation runs in Step 7 (return value);
  // keeping it here avoids two passes through countActiveAtOrAbove and
  // ensures the rendered summary matches the actual process exit.
  const findingsAtThreshold =
    countActiveAtOrAbove(scan.result.findings, resolvedConfig.fail_on) > 0;
  const staleAsError = resolvedConfig.suppressions_strict && scan.stale.length > 0;
  const exitCode = computeExitCode({
    configError: false,
    engineError: false,
    belowParseCoverage: coverage.belowMin,
    findingsAtThreshold: findingsAtThreshold || staleAsError,
  });

  // Step 6 — Format dispatch.
  switch (resolvedConfig.format) {
    case "text":
      // v0.7.3 Stitch verbose banner — emitted FIRST so the provenance
      // (engine/rule-pack version, cited %, scope) frames everything below.
      // Cited-count walks the ruleSet once; cheap (<1ms even at 230 rules).
      if (verbose && scan.ruleSet !== null) {
        const ruleCount = scan.ruleSet.rules.length;
        const citedCount = scan.ruleSet.rules.filter(
          (r) => r.references !== null && r.references.length > 0,
        ).length;
        const providerCount = Object.keys(scan.ruleSet.providers ?? {}).length;
        const fileCount = new Set(scan.result.inventory.map((h) => h.file_path)).size;
        process.stdout.write(
          renderScanBanner({
            useAnsi,
            metadata: scan.result.metadata,
            ruleCount,
            citedCount,
            providerCount,
            scope: args.path ?? ".",
            handlerCount: scan.result.inventory.length,
            fileCount,
          }),
        );
        process.stdout.write("\n");
      }
      // --verbose shows its work: every webhook handler the scan found (with
      // its provider/framework/verdict) before the findings detail below.
      if (verbose && scan.result.inventory.length > 0) {
        process.stdout.write(
          `${dim(`Handlers scanned — ${scan.result.inventory.length}`, { useAnsi })}\n`,
        );
        process.stdout.write(renderInventory(scan.result, { useAnsi, cwd: baseDir }));
        process.stdout.write("\n");
      }
      process.stdout.write(
        renderFindings(scan.result, scan.ruleSet, { useAnsi, cwd: baseDir, verbose }),
      );
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
          exitCode,
          failOn: resolvedConfig.fail_on,
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

  // v0.7.4 update banner — emitted AFTER findings + summary so it lives at
  // the bottom of the visible output where users naturally land. Gated to
  // text-format scans + TTY contexts (json/sarif consumers see nothing).
  // No-op if the background check hasn't resolved yet or current === latest.
  maybeRenderUpdateBanner(updateNotifier, {
    useAnsi,
    format: resolvedConfig.format,
  });

  // Step 7 — Exit-code reporting (D-65 precedence: 3 > 2 > 4 > 1 > 0;
  // config + engine already returned earlier). Exit code itself was
  // pre-computed in Step 6.0 so the verbose summary could annotate it.
  if (staleAsError) {
    process.stderr.write(
      `error: ${scan.stale.length} stale suppression(s) detected (--strict-suppressions)\n`,
    );
  }
  return exitCode;
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
    history: {
      type: "boolean",
      description:
        "Scan the git history for leaked secrets, INCLUDING files deleted before HEAD (default scans the worktree only). Off by default; bounded to the last 1000 commits unless --since is given.",
    },
    since: {
      type: "string",
      description:
        "Bound the --history walk to a git ref (e.g. 'v1.0.0') or a date (e.g. '2026-01-01'). Requires --history.",
    },
    config: {
      type: "string",
      description: "Path to hookwarden.config.yaml (overrides walk-up discovery)",
    },
    "no-config": { type: "boolean", description: "Bypass config-file discovery" },
    "no-trivia": {
      type: "boolean",
      description:
        "Suppress the rotating webhook-security tips that appear on stderr during long scans. Already auto-disabled in CI / non-TTY / NO_COLOR.",
    },
    "no-update-notifier": {
      type: "boolean",
      description:
        "Suppress the 'update available' notice that appears when a newer hookwarden is on npm. Already auto-disabled in CI / non-TTY / NO_COLOR.",
    },
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
    "severity-class": {
      type: "string",
      description:
        "Restrict the scan to a rule-class group. 'production-bypass' = the classes where a forged or replayed request would be accepted in production (verification missing, defeated, bypassable, or replay-able); excludes secret-leak and positive-signal rules.",
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
