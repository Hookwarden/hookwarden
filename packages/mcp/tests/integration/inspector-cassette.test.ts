// Plan 23-05 Task 2 Test 2 — Inspector cassette equivalent via SDK Client.
//
// Uses the SDK's own Client + StdioClientTransport to exercise the same
// surface `@modelcontextprotocol/inspector --cli` would (tools/list +
// scan_handler inputSchema) — without pulling the heavy inspector binary
// download into the CI dependency graph. Functionally equivalent contract
// test against the published SDK 1.29.0.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PKG_ROOT, "dist", "cli.js");
const MANIFEST_PATH = path.join(PKG_ROOT, "dist", "build-manifest.json");

interface BackupState {
  readonly existed: boolean;
  readonly content?: string;
}

async function backupManifest(): Promise<BackupState> {
  try {
    return { existed: true, content: await fs.readFile(MANIFEST_PATH, "utf-8") };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { existed: false };
    throw err;
  }
}

async function ensureCleanManifest(): Promise<BackupState> {
  const backup = await backupManifest();
  if (backup.existed) {
    try {
      const parsed = JSON.parse(backup.content ?? "");
      if (parsed?.engine?.version === "0.7.0") return backup;
    } catch {
      /* fall through */
    }
  }
  const { execSync } = await import("node:child_process");
  execSync(`node ${path.join(PKG_ROOT, "scripts", "emit-build-manifest.mjs")}`);
  return backup;
}

describe("inspector cassette equivalent (SDK Client over stdio)", () => {
  let backup: BackupState;

  beforeEach(async () => {
    backup = await ensureCleanManifest();
  });

  afterEach(async () => {
    if (backup.existed && backup.content !== undefined) {
      await fs.writeFile(MANIFEST_PATH, backup.content);
    }
  });

  it("tools/list returns scan_handler with documented inputSchema", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [CLI_PATH],
    });
    const client = new Client({ name: "vitest-cassette", version: "0.0.0" });
    await client.connect(transport);

    try {
      const result = await client.listTools();
      expect(result.tools).toBeDefined();
      const scanHandlerTool = result.tools.find((t) => t.name === "scan_handler");
      expect(scanHandlerTool).toBeDefined();
      expect(scanHandlerTool?.description).toMatch(/hookwarden/i);
      expect(scanHandlerTool?.inputSchema).toBeDefined();
      const inputSchema = scanHandlerTool?.inputSchema as { properties?: Record<string, unknown> };
      expect(inputSchema.properties).toBeDefined();
      // Documented inputs per Plan 23-02 registration: code, files, language, provider.
      for (const key of ["code", "files", "language", "provider"]) {
        expect(inputSchema.properties).toHaveProperty(key);
      }
    } finally {
      await client.close();
    }
  });

  it("tools/call scan_handler with empty input returns isError:true (negative coverage)", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [CLI_PATH],
    });
    const client = new Client({ name: "vitest-cassette", version: "0.0.0" });
    await client.connect(transport);

    try {
      const result = await client.callTool({
        name: "scan_handler",
        arguments: {},
      });
      expect(result.isError).toBe(true);
      const sc = result.structuredContent as { error: string };
      expect(sc.error).toBe("empty_input");
    } finally {
      await client.close();
    }
  });
});
