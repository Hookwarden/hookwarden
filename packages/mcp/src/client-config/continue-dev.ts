// Continue.dev uses a per-server YAML file at
// ~/.continue/mcpServers/<name>.yaml — NOT a JSON merge into a shared
// config. The shape is static (4 lines, no user content interpolated
// beyond the constant package name) so a hand-rolled emitter is correct.

import { promises as fs } from "node:fs";
import { dirname } from "node:path";

import type { WriteOptions, WriteResult } from "./claude-desktop.js";

const CONTINUE_YAML = `name: hookwarden
command: npx
args: [-y, "@hookwarden/mcp"]
`;

export async function writeContinueDevConfig(
  configPath: string,
  opts: WriteOptions = {},
): Promise<WriteResult> {
  const dryRun = opts.dryRun === true;
  const forceOverwrite = opts.forceOverwrite === true;

  let existingRaw: string | null = null;
  try {
    existingRaw = await fs.readFile(configPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      return { status: "error", path: configPath, error: (err as Error).message };
    }
  }

  if (existingRaw !== null && !forceOverwrite) {
    if (existingRaw === CONTINUE_YAML) {
      return { status: "skipped", path: configPath, error: "exists" };
    }
    return { status: "skipped", path: configPath, error: "exists" };
  }

  if (dryRun) {
    return { status: existingRaw !== null ? "updated" : "added", path: configPath };
  }

  await fs.mkdir(dirname(configPath), { recursive: true });

  let backup: string | undefined;
  if (existingRaw !== null) {
    backup = `${configPath}.bak`;
    await fs.writeFile(backup, existingRaw);
  }

  const tmpPath = `${configPath}.tmp`;
  await fs.writeFile(tmpPath, CONTINUE_YAML);
  await fs.rename(tmpPath, configPath);

  return {
    status: existingRaw !== null ? "updated" : "added",
    path: configPath,
    ...(backup !== undefined && { backup }),
  };
}
