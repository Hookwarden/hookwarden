// `hookwarden inventory <path>` subcommand. DISCOVERY-01 (CLI portion).

import { defineCommand } from "citty";
import { CONFIG_DEFAULTS } from "../config/precedence.js";
import { runScan } from "../pipeline.js";
import { renderInventory, renderSummary } from "../render/index.js";
import { shouldUseAnsi } from "../walker/tty.js";

export interface InventoryArgs {
  readonly path?: string;
  readonly "no-color"?: boolean;
  readonly "rules-dir"?: string;
}

export async function runInventoryCommand(args: InventoryArgs): Promise<number> {
  const rootPath = args.path ?? ".";
  const noColor = args["no-color"] === true;
  const useAnsi = noColor ? false : shouldUseAnsi(process.stdout);
  const cwd = process.cwd();

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
    verbose: false,
  });

  process.stdout.write(renderInventory(scan.result, { useAnsi, cwd }));
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
  },
  run: async ({ args }) => runInventoryCommand(args as InventoryArgs),
});
