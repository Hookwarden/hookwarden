// Per-OS MCP-client config-path lookup table. Paths verified 2026-05-30
// against Claude Desktop / Cursor / Continue.dev official docs (RESEARCH
// §Pattern 4). Linux Claude Desktop is intentionally absent — Anthropic's
// download page lists macOS + Windows only as of 2026-05 (RESEARCH §A2).

import * as path from "node:path";

export type ConfigFormat = "json" | "yaml";

export interface ConfigPath {
  readonly client: "claude-desktop" | "cursor" | "continue-dev";
  readonly path: string;
  readonly format: ConfigFormat;
  /** For JSON formats: the top-level key to merge into. Continue YAML omits. */
  readonly jsonKey?: "mcpServers";
}

export interface GetClientConfigPathsInput {
  readonly platform: NodeJS.Platform | string;
  readonly homedir: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export function getClientConfigPaths(input: GetClientConfigPathsInput): ReadonlyArray<ConfigPath> {
  const { platform, homedir } = input;
  const env = input.env ?? {};

  const claudeDarwin = path.join(
    homedir,
    "Library",
    "Application Support",
    "Claude",
    "claude_desktop_config.json",
  );
  const claudeWin = path.join(
    env["APPDATA"] ?? path.join(homedir, "AppData", "Roaming"),
    "Claude",
    "claude_desktop_config.json",
  );
  const cursor = path.join(homedir, ".cursor", "mcp.json");
  const continueDev = path.join(homedir, ".continue", "mcpServers", "hookwarden.yaml");

  if (platform === "darwin") {
    return [
      { client: "claude-desktop", path: claudeDarwin, format: "json", jsonKey: "mcpServers" },
      { client: "cursor", path: cursor, format: "json", jsonKey: "mcpServers" },
      { client: "continue-dev", path: continueDev, format: "yaml" },
    ];
  }
  if (platform === "win32") {
    return [
      { client: "claude-desktop", path: claudeWin, format: "json", jsonKey: "mcpServers" },
      { client: "cursor", path: cursor, format: "json", jsonKey: "mcpServers" },
      { client: "continue-dev", path: continueDev, format: "yaml" },
    ];
  }
  if (platform === "linux") {
    // Per RESEARCH §A2: no Linux Claude Desktop binary as of 2026-05.
    return [
      { client: "cursor", path: cursor, format: "json", jsonKey: "mcpServers" },
      { client: "continue-dev", path: continueDev, format: "yaml" },
    ];
  }
  return [];
}

// Canonical HOOKWARDEN_ENTRY shape — same across all clients per RESEARCH
// Pattern 6. Anthropic Agent SDK uses the identical shape programmatically.
export const HOOKWARDEN_ENTRY = {
  command: "npx",
  args: ["-y", "@hookwarden/mcp"],
} as const;
