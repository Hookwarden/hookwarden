// `npx @hookwarden/mcp init` — install accelerator that registers the
// hookwarden MCP server in the user's installed MCP clients. Replaces
// the Plan 23-02 stub.

import { existsSync } from "node:fs";
import * as os from "node:os";
import { defineCommand, runMain } from "citty";
import pc from "picocolors";

import { writeClaudeDesktopConfig } from "./client-config/claude-desktop.js";
import { writeContinueDevConfig } from "./client-config/continue-dev.js";
import { writeCursorConfig } from "./client-config/cursor.js";
import { type ConfigPath, getClientConfigPaths } from "./client-config/paths.js";

// Re-exported so Plan 23-07 docs can import the canonical Anthropic SDK
// snippet from the init module (single source of truth for the README +
// docs pages).
export { getAnthropicSdkSnippet } from "./client-config/anthropic-sdk.js";

interface ExecuteOptions {
  readonly all: boolean;
  readonly dryRun: boolean;
  readonly force: boolean;
  /** Comma-separated subset; undefined = use detection */
  readonly clients?: string;
  /** Test injection — override platform, homedir, env */
  readonly platform?: NodeJS.Platform | string;
  readonly homedir?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Test injection — capture stderr/stdout into a buffer instead of writing to process.std* */
  readonly stdout?: { write: (chunk: string) => void };
}

interface ClientRowResult {
  readonly client: ConfigPath["client"];
  readonly path: string;
  readonly status: "added" | "updated" | "skipped" | "error" | "not-detected";
  readonly error?: string;
  readonly backup?: string;
}

const NEXT_STEPS: Record<ConfigPath["client"], string> = {
  "claude-desktop": "Restart Claude Desktop to load",
  cursor: "Cursor reloads on next chat",
  "continue-dev": "Continue picks up new YAML on next chat",
};

// Exported for testability — bypasses runMain so tests don't have to spawn
// child processes. The runInit entry point below wires this into citty.
export async function executeInit(opts: ExecuteOptions): Promise<{
  readonly exitCode: number;
  readonly rows: ReadonlyArray<ClientRowResult>;
}> {
  const platform = opts.platform ?? process.platform;
  const homedir = opts.homedir ?? os.homedir();
  const env = opts.env ?? process.env;
  const out = opts.stdout ?? process.stdout;

  const paths = getClientConfigPaths({ platform, homedir, env });

  const selectedClients: Set<string> | null = opts.clients
    ? new Set(opts.clients.split(",").map((s) => s.trim()))
    : null;

  const rows: ClientRowResult[] = [];
  for (const cp of paths) {
    if (selectedClients !== null && !selectedClients.has(cp.client)) continue;

    const writeOpts = { dryRun: opts.dryRun, forceOverwrite: opts.force };
    let result;
    if (cp.client === "claude-desktop") {
      // Detection for Claude Desktop: parent dir existence (config file
      // may not exist yet on first install, but the Claude/ dir does).
      const { dirname } = await import("node:path");
      if (!existsSync(dirname(cp.path))) {
        rows.push({ client: cp.client, path: cp.path, status: "not-detected" });
        continue;
      }
      result = await writeClaudeDesktopConfig(cp.path, writeOpts);
    } else if (cp.client === "cursor") {
      const { dirname } = await import("node:path");
      if (!existsSync(dirname(cp.path))) {
        rows.push({ client: cp.client, path: cp.path, status: "not-detected" });
        continue;
      }
      result = await writeCursorConfig(cp.path, writeOpts);
    } else {
      const { dirname } = await import("node:path");
      if (!existsSync(dirname(cp.path))) {
        rows.push({ client: cp.client, path: cp.path, status: "not-detected" });
        continue;
      }
      result = await writeContinueDevConfig(cp.path, writeOpts);
    }

    rows.push({
      client: cp.client,
      path: result.path,
      status: result.status,
      ...(result.error !== undefined && { error: result.error }),
      ...(result.backup !== undefined && { backup: result.backup }),
    });
  }

  // Print verdict-first summary table per [[feedback_cli_output_user_readable]]
  out.write("\nhookwarden-mcp init\n\n");
  let backupCount = 0;
  for (const row of rows) {
    const icon =
      row.status === "added" || row.status === "updated"
        ? pc.green("✓")
        : row.status === "skipped" || row.status === "not-detected"
          ? pc.yellow("—")
          : pc.red("✗");
    const next =
      row.status === "added" || row.status === "updated"
        ? NEXT_STEPS[row.client]
        : row.status === "skipped"
          ? "exists — use --force to overwrite"
          : row.status === "not-detected"
            ? "client not installed"
            : (row.error ?? "unknown error");
    out.write(`  ${icon} ${row.client.padEnd(16)} ${row.status.padEnd(14)} ${next}\n`);
    out.write(`    ${pc.dim(row.path)}\n`);
    if (row.backup) backupCount += 1;
  }

  out.write(`\n  ${pc.dim("— Anthropic SDK")}    ${pc.dim("(programmatic — copy snippet from README)")}\n`);

  if (backupCount > 0) {
    out.write(
      `\n${pc.dim(`Backups: ${backupCount} .bak file${backupCount === 1 ? "" : "s"} written next to each modified config.`)}\n`,
    );
  }

  const exitCode = rows.some((r) => r.status === "error") ? 1 : 0;
  return { exitCode, rows };
}

const rootCmd = defineCommand({
  meta: {
    name: "hookwarden-mcp init",
    description:
      "Register hookwarden's MCP server in installed MCP clients (Claude Desktop, Cursor, Continue.dev).",
  },
  args: {
    all: {
      type: "boolean",
      description: "Write to all detected clients without prompting",
    },
    "dry-run": {
      type: "boolean",
      alias: "n",
      description: "Show what would change without writing",
    },
    force: {
      type: "boolean",
      description: "Overwrite existing hookwarden entries without prompting",
    },
    clients: {
      type: "string",
      description: "Comma-separated subset (claude-desktop,cursor,continue-dev)",
    },
  },
  async run({ args }) {
    const opts: ExecuteOptions = {
      all: Boolean(args.all),
      dryRun: Boolean(args["dry-run"]),
      force: Boolean(args.force),
      ...(typeof args.clients === "string" && args.clients.length > 0
        ? { clients: args.clients }
        : {}),
    };
    const { exitCode } = await executeInit(opts);
    if (exitCode !== 0) process.exit(exitCode);
  },
});

export async function runInit(argv: ReadonlyArray<string>): Promise<number> {
  await runMain(rootCmd, { rawArgs: [...argv] });
  // runMain returns normally on success (the command's `run` may have
  // process.exit'd on error). Reach here only on success → exit 0.
  return 0;
}
