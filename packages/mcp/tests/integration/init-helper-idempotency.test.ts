// Plan 23-06 Task 2 Tests 2 + 3 — idempotency + sibling preservation.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { executeInit } from "../../src/init.js";

let tmpHome: string;
let stdout: string;
const stdoutCollector = { write: (chunk: string): void => { stdout += chunk; } };

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "hookwarden-init-idem-"));
  stdout = "";
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe("init helper — idempotency + sibling preservation", () => {
  it("Test 2: two runs produce identical mcpServers.hookwarden, no duplicates", async () => {
    await fs.mkdir(path.join(tmpHome, ".cursor"), { recursive: true });

    // First run — adds hookwarden.
    const first = await executeInit({
      all: true,
      dryRun: false,
      force: false,
      platform: "darwin",
      homedir: tmpHome,
      stdout: stdoutCollector,
    });
    expect(first.exitCode).toBe(0);
    const cfgPath = path.join(tmpHome, ".cursor", "mcp.json");
    const afterFirst = await fs.readFile(cfgPath, "utf-8");

    // Second run — hookwarden already there; should "skip" (idempotent).
    const second = await executeInit({
      all: true,
      dryRun: false,
      force: false,
      platform: "darwin",
      homedir: tmpHome,
      stdout: stdoutCollector,
    });
    expect(second.exitCode).toBe(0);
    const cursorRowSecond = second.rows.find((r) => r.client === "cursor");
    expect(cursorRowSecond?.status).toBe("skipped");

    const afterSecond = await fs.readFile(cfgPath, "utf-8");
    expect(afterSecond).toBe(afterFirst);
  });

  it("Test 3: sibling mcpServers entries preserved through init", async () => {
    await fs.mkdir(path.join(tmpHome, ".cursor"), { recursive: true });
    const cfgPath = path.join(tmpHome, ".cursor", "mcp.json");
    await fs.writeFile(
      cfgPath,
      JSON.stringify({
        mcpServers: {
          filesystem: { command: "fs-mcp", args: [] },
          memory: { command: "mem-mcp", args: [] },
        },
      }),
    );

    await executeInit({
      all: true,
      dryRun: false,
      force: false,
      platform: "darwin",
      homedir: tmpHome,
      stdout: stdoutCollector,
    });

    const merged = JSON.parse(await fs.readFile(cfgPath, "utf-8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(Object.keys(merged.mcpServers).sort()).toEqual([
      "filesystem",
      "hookwarden",
      "memory",
    ]);
  });
});
