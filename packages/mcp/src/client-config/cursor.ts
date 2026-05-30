// Cursor mcp.json uses the same shape Claude Desktop does — top-level
// `mcpServers` map with per-server-name entries. Reuse the JSON-merge.

import {
  type WriteOptions,
  type WriteResult,
  writeJsonMcpServersConfig,
} from "./claude-desktop.js";

export async function writeCursorConfig(
  configPath: string,
  opts: WriteOptions = {},
): Promise<WriteResult> {
  return writeJsonMcpServersConfig(configPath, opts);
}
