// hookwarden CLI entry. D-45 citty defineCommand. D-46 sibling scan + inventory.
// D-47 no-arg help. D-48 zero-config flags. D-49 exit 0/1/2.

import { defineCommand } from "citty";
import { type InventoryArgs, inventoryCommand, runInventoryCommand } from "./commands/inventory.js";
import { type ScanArgs, runScanCommand, scanCommand } from "./commands/scan.js";

const VERSION = "0.0.1"; // Changesets bumps in lockstep (D-05).

// Public registration of the citty command tree (consumed by hosts that prefer citty's runMain).
export const root = defineCommand({
  meta: {
    name: "hookwarden",
    version: VERSION,
    description:
      "Webhook security audit CLI. Find signature-verification bugs in JS/TS and Python.",
  },
  subCommands: {
    scan: scanCommand,
    inventory: inventoryCommand,
  },
});

const HELP_TEXT =
  `hookwarden v${VERSION} — webhook security audit CLI\n\n` +
  `Usage:\n` +
  `  hookwarden scan [path]       Scan a project for verification bugs.\n` +
  `  hookwarden inventory [path]  List every detected webhook handler.\n\n` +
  `Flags (per subcommand):\n` +
  `  -v, --verbose      Verbose output (scan only).\n` +
  `      --no-color     Disable color and OSC-8 hyperlinks.\n` +
  `      --rules-dir D  Override the bundled rule pack (dev-only).\n` +
  `      --help, -h     Show subcommand help.\n` +
  `      --version, -V  Print CLI version.\n`;

interface ParsedFlags {
  path?: string;
  verbose?: boolean;
  "no-color"?: boolean;
  "rules-dir"?: string;
  help?: boolean;
}

function parseFlags(argv: ReadonlyArray<string>): ParsedFlags {
  const out: ParsedFlags = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === undefined) {
      i++;
      continue;
    }
    if (arg === "-v" || arg === "--verbose") {
      out.verbose = true;
      i++;
      continue;
    }
    if (arg === "--no-color") {
      out["no-color"] = true;
      i++;
      continue;
    }
    if (arg === "--rules-dir") {
      const next = argv[i + 1];
      if (next !== undefined) out["rules-dir"] = next;
      i += 2;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      i++;
      continue;
    }
    if (!arg.startsWith("-") && out.path === undefined) {
      out.path = arg;
      i++;
      continue;
    }
    // Unknown flag: skip silently (Phase 4 introduces strict flag validation).
    i++;
  }
  return out;
}

export async function main(argv: ReadonlyArray<string>): Promise<number> {
  // No args → print help and exit 0 (D-47).
  if (argv.length === 0) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  // Top-level --version / -V → print and exit 0.
  if (argv[0] === "--version" || argv[0] === "-V") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  // Top-level --help / -h → print help and exit 0.
  if (argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  const sub = argv[0];
  try {
    if (sub === "scan") {
      const parsed = parseFlags(argv.slice(1));
      if (parsed.help === true) {
        process.stdout.write(`Usage: hookwarden scan [path] [flags]\n`);
        return 0;
      }
      return await runScanCommand(parsed as ScanArgs);
    }
    if (sub === "inventory") {
      const parsed = parseFlags(argv.slice(1));
      if (parsed.help === true) {
        process.stdout.write(`Usage: hookwarden inventory [path] [flags]\n`);
        return 0;
      }
      return await runInventoryCommand(parsed as InventoryArgs);
    }
    process.stderr.write(`error: unknown command '${sub}'\nrun 'hookwarden' for help\n`);
    return 2;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: ${message}\n`);
    return 2;
  }
}
