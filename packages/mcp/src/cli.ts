#!/usr/bin/env node
// Single-bin dispatcher entry — supersedes D-23-16 per RESEARCH §Pitfall 4.
// One bin (`hookwarden-mcp`) routes:
//   `--version` / `-V`  →  print VERSION
//   `init [...]`        →  lazy import init.ts (Plan 23-06)
//   (no argv)           →  lazy import server.ts (boot stdio MCP server)
//
// Lazy imports keep the cold-boot path small: the typical invocation
// (no argv, boot stdio server) never touches init.ts; the `init` flow never
// touches the MCP SDK boot graph.

import { VERSION } from "./version.js";

async function main(argv: ReadonlyArray<string>): Promise<number> {
  if (argv[0] === "--version" || argv[0] === "-V") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (argv[0] === "init") {
    const { runInit } = await import("./init.js");
    return runInit(argv.slice(1));
  }
  const { bootServer } = await import("./server.js");
  return bootServer();
}

// Self-invoke entry — mirrors packages/cli/src/index.ts lines 353-360.
const isCompiledEntry = (import.meta as ImportMeta & { main?: boolean }).main === true;
if (isCompiledEntry) {
  const code = await main(process.argv.slice(2));
  process.exit(code);
}
