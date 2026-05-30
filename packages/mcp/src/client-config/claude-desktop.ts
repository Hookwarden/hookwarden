// Atomic JSON merge for Claude Desktop config: read → parse → backup →
// merge → write-temp → rename. Crash-safe — partial writes cannot corrupt
// the user's existing config because rename is atomic on POSIX and within
// the same volume on Windows.

import { promises as fs } from "node:fs";

import { HOOKWARDEN_ENTRY } from "./paths.js";

export type WriteStatus = "added" | "updated" | "skipped" | "error";

export interface WriteResult {
  readonly status: WriteStatus;
  readonly path: string;
  readonly backup?: string;
  readonly error?: string;
}

export interface WriteOptions {
  readonly dryRun?: boolean;
  readonly forceOverwrite?: boolean;
}

export async function writeClaudeDesktopConfig(
  configPath: string,
  opts: WriteOptions = {},
): Promise<WriteResult> {
  return writeJsonMcpServersConfig(configPath, opts);
}

// Shared between Claude Desktop and Cursor — both use the same JSON-merge
// shape (top-level `mcpServers` map with per-server-name entries).
export async function writeJsonMcpServersConfig(
  configPath: string,
  opts: WriteOptions = {},
): Promise<WriteResult> {
  const dryRun = opts.dryRun === true;
  const forceOverwrite = opts.forceOverwrite === true;

  let existing: Record<string, unknown> | null = null;
  let existingRaw: string | null = null;
  try {
    existingRaw = await fs.readFile(configPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      return { status: "error", path: configPath, error: (err as Error).message };
    }
  }

  if (existingRaw !== null) {
    try {
      existing = JSON.parse(existingRaw) as Record<string, unknown>;
    } catch {
      return {
        status: "error",
        path: configPath,
        error: `config_parse_failed at ${configPath}`,
      };
    }
  }

  const currentServers =
    existing !== null && typeof existing["mcpServers"] === "object" && existing["mcpServers"] !== null
      ? (existing["mcpServers"] as Record<string, unknown>)
      : {};

  const alreadyHasHookwarden = Object.prototype.hasOwnProperty.call(currentServers, "hookwarden");
  if (alreadyHasHookwarden && !forceOverwrite) {
    return { status: "skipped", path: configPath, error: "exists" };
  }

  const merged = {
    ...(existing ?? {}),
    mcpServers: { ...currentServers, hookwarden: HOOKWARDEN_ENTRY },
  };
  const serialized = `${JSON.stringify(merged, null, 2)}\n`;

  if (dryRun) {
    return {
      status: alreadyHasHookwarden ? "updated" : "added",
      path: configPath,
    };
  }

  // Ensure parent directory exists (first-time install).
  const { dirname } = await import("node:path");
  await fs.mkdir(dirname(configPath), { recursive: true });

  // Backup BEFORE mutation (D-23-Discretion). Only if the original existed.
  let backup: string | undefined;
  if (existingRaw !== null) {
    backup = `${configPath}.bak`;
    await fs.writeFile(backup, existingRaw);
  }

  // Atomic write: temp file + rename.
  const tmpPath = `${configPath}.tmp`;
  await fs.writeFile(tmpPath, serialized);
  await fs.rename(tmpPath, configPath);

  return {
    status: alreadyHasHookwarden ? "updated" : "added",
    path: configPath,
    ...(backup !== undefined && { backup }),
  };
}
