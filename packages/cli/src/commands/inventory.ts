// `hookwarden inventory <path>` subcommand. DISCOVERY-01 (CLI portion).
//
// v0.7.6: `--all` opts back into the historical un-filtered candidate list
// (the engine's raw output before the webhook-evidence filter). `--verbose`
// adds an `evidence` column with the per-handler signal count, so users
// can see WHY each surviving handler made it through.

import { statSync } from "node:fs";
import * as path from "node:path";
import { defineCommand } from "citty";
import { CONFIG_DEFAULTS } from "../config/precedence.js";
import { runScan } from "../pipeline.js";
import { renderInventory, renderSummary } from "../render/index.js";
import { shouldUseAnsi } from "../walker/tty.js";

export interface InventoryArgs {
  readonly path?: string;
  readonly "no-color"?: boolean;
  readonly "rules-dir"?: string;
  readonly all?: boolean;
  readonly verbose?: boolean;
}

export async function runInventoryCommand(args: InventoryArgs): Promise<number> {
  const rootPath = args.path ?? ".";
  const noColor = args["no-color"] === true;
  const useAnsi = noColor ? false : shouldUseAnsi(process.stdout);
  // file:line hyperlinks resolve repo-relative file_paths against the SCAN ROOT
  // (the pipeline's scanDir), not process.cwd() — those differ whenever the
  // scanned path isn't the working directory, and using cwd produced links into
  // the wrong directory. Mirror runScan's file→dirname split for single-file
  // targets. nonexistent paths fall through to the pipeline's error handling.
  let baseDir = path.resolve(rootPath);
  try {
    if (statSync(baseDir).isFile()) baseDir = path.dirname(baseDir);
  } catch {
    /* nonexistent / unreadable — pipeline surfaces the error */
  }

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
    verbose: args.verbose === true,
  });

  process.stdout.write(
    renderInventory(scan.result, {
      useAnsi,
      cwd: baseDir,
      all: args.all === true,
      verbose: args.verbose === true,
    }),
  );
  process.stdout.write(
    renderSummary(scan.result, {
      useAnsi,
      durationMs: scan.durationMs,
      testExcludedCount: scan.walkResult.test_excluded_count,
    }),
  );

  return 0;
}

export const inventoryCommand = defineCommand({
  meta: {
    name: "inventory",
    description: "List every detected webhook handler with its verification state.",
  },
  args: {
    path: {
      type: "positional",
      required: false,
      description: "Project root (default: .)",
      default: ".",
    },
    "no-color": { type: "boolean", description: "Disable color and OSC-8 hyperlinks." },
    "rules-dir": {
      type: "string",
      description: "Override the bundled rule pack location (dev-only).",
    },
    all: {
      type: "boolean",
      description:
        "Show every route candidate, including handlers with zero webhook evidence (auth routes, cron endpoints, generic API handlers). Default: only handlers with ≥1 webhook signal.",
    },
    verbose: {
      alias: "v",
      type: "boolean",
      description: "Add an `evidence` column to the table showing the per-handler signal count.",
    },
  },
  run: async ({ args }) => runInventoryCommand(args as InventoryArgs),
});
