// Stdio MCP server boot — Phase 23 Plan 23-02. Owns:
//  1. The boot-time drift gate (D-23-12): a stale install fails fast with a
//     structured stderr message rather than booting and silently delivering
//     stale-rule-pack verdicts.
//  2. The transport boot via @modelcontextprotocol/sdk@1.29.0 stdio shim.
//  3. The scan_handler tool registration (placeholder handler — Plan 23-05
//     replaces with the real engine-backed implementation).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { checkDrift, loadBuildManifest } from "./drift-check.js";
import { scanHandler } from "./tools/scan-handler.js";
import type { ScanHandlerInput } from "./types.js";
import { VERSION } from "./version.js";

const REINSTALL = "npm i -g @hookwarden/mcp@latest";

export async function bootServer(): Promise<number> {
  // ── 1. Load build-manifest ───────────────────────────────────────────────
  let manifest;
  try {
    manifest = await loadBuildManifest();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `hookwarden-mcp: build-manifest missing — package not properly built; reinstall via ${REINSTALL}\n  detail: ${message}\n`,
    );
    return 1;
  }

  // ── 2. Boot-time drift gate ──────────────────────────────────────────────
  const drift = await checkDrift(manifest);
  if (drift !== null) {
    process.stderr.write(
      `hookwarden-mcp: ${drift.error} detected at boot.\n` +
        `  component: ${drift.component}\n` +
        `  pinned:    ${drift.pinned}\n` +
        `  current:   ${drift.current}\n` +
        `  fix:       ${drift.suggestion}\n`,
    );
    return 1;
  }

  // ── 3. Register scan_handler (placeholder until Plan 23-05) ─────────────
  const server = new McpServer({ name: "@hookwarden/mcp", version: VERSION });
  server.registerTool(
    "scan_handler",
    {
      description:
        "Scan webhook handler code for signature-verification bugs using hookwarden's deterministic AST rules.",
      inputSchema: {
        code: z.string().optional(),
        files: z.record(z.string(), z.string()).optional(),
        language: z.enum(["js", "ts", "python", "php"]).optional(),
        provider: z.string().optional(),
      },
    },
    // SDK CallToolResult expects structuredContent shaped as `{ [x: string]: unknown }`;
    // our typed ScanHandlerStructuredContent satisfies it at runtime. Cast through
    // `unknown` to avoid TS structural-match failures on the readonly/index-signature
    // delta between the interfaces.
    async (args) =>
      (await scanHandler(args as ScanHandlerInput, manifest)) as unknown as Awaited<
        ReturnType<Parameters<typeof server.registerTool>[2]>
      >,
  );

  // ── 4. Connect transport — server.connect() resolves once the transport
  // is wired; we must hold the event loop OPEN until stdin closes
  // (otherwise cli.ts's `process.exit(0)` would kill the server immediately
  // after bootServer returns). Wait on the transport's close signal.
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise<void>((resolve) => {
    transport.onclose = (): void => resolve();
  });
  return 0;
}
