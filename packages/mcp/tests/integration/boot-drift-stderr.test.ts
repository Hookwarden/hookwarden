// Plan 23-02 Task 2 Test — boot-time drift gate (VALIDATION line 59).
//
// Spawns the built dist/cli.js with a synthetic packages/mcp/build-manifest.json
// declaring engine.version = "9.99.99" (impossible-to-match), asserts the
// process exits non-zero and stderr starts with `hookwarden-mcp: engine_drift`.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..", "..");
const MANIFEST_PATH = path.join(PKG_ROOT, "build-manifest.json");
const CLI_PATH = path.join(PKG_ROOT, "dist", "cli.js");

const SYNTHETIC_DRIFT_MANIFEST = {
  engine: { version: "9.99.99", content_hash: null },
  rules: { version: "9.99.99", content_hash: "0".repeat(64) },
  built_at: "2026-05-30T00:00:00Z",
};

interface BackupState {
  readonly existed: boolean;
  readonly content?: string;
}

async function backupManifest(): Promise<BackupState> {
  try {
    const content = await fs.readFile(MANIFEST_PATH, "utf-8");
    return { existed: true, content };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { existed: false };
    throw err;
  }
}

async function restoreManifest(backup: BackupState): Promise<void> {
  if (backup.existed && backup.content !== undefined) {
    await fs.writeFile(MANIFEST_PATH, backup.content);
  } else {
    await fs.rm(MANIFEST_PATH, { force: true });
  }
}

interface RunResult {
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

function runCli(): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ exitCode: code, stderr, stdout }));
    // Boot-time drift causes return BEFORE awaiting stdin, so we don't need to
    // write anything — but close stdin to be safe against the success path
    // (which would hang waiting for MCP frames).
    child.stdin.end();
  });
}

describe("MCP server boot — drift gate exits non-zero with structured stderr", () => {
  let backup: BackupState;

  beforeEach(async () => {
    backup = await backupManifest();
    await fs.writeFile(MANIFEST_PATH, JSON.stringify(SYNTHETIC_DRIFT_MANIFEST, null, 2));
  });

  afterEach(async () => {
    await restoreManifest(backup);
  });

  it("forced engine drift → exit non-zero + stderr matches `^hookwarden-mcp: engine_drift`", async () => {
    const result = await runCli();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/^hookwarden-mcp: engine_drift\b/);
    expect(result.stderr).toContain("component: engine");
    expect(result.stderr).toContain("pinned:    9.99.99");
    expect(result.stderr).toContain("fix:       npm i -g @hookwarden/mcp@latest");
  });
});
