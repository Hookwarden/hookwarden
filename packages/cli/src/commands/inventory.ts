// `hookwarden inventory <path>` subcommand. DISCOVERY-01 (CLI portion).

import { defineCommand } from "citty";
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

  const scanInput =
    args["rules-dir"] !== undefined
      ? { rootPath, rulesDir: args["rules-dir"] }
      : { rootPath };
  const scan = await runScan(scanInput);

  process.stdout.write(renderInventory(scan.result, { useAnsi, cwd }));
  process.stdout.write(renderSummary(scan.result, { useAnsi, durationMs: scan.durationMs }));

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
