// Plan 23-06 Task 2 Tests 5 + 8 — overwrite behavior + malformed JSON.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { executeInit } from "../../src/init.js";

let tmpHome: string;
let _stdout: string;
const stdoutCollector = {
  write: (chunk: string): void => {
    _stdout += chunk;
  },
};

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "hookwarden-init-overwrite-"));
  _stdout = "";
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe("init helper — overwrite + malformed config", () => {
  it("Test 5a: existing hookwarden entry → skipped without --force", async () => {
    await fs.mkdir(path.join(tmpHome, ".cursor"), { recursive: true });
    const cfgPath = path.join(tmpHome, ".cursor", "mcp.json");
    await fs.writeFile(
      cfgPath,
      JSON.stringify({ mcpServers: { hookwarden: { command: "old-cmd", args: [] } } }),
    );

    const { rows } = await executeInit({
      all: true,
      dryRun: false,
      force: false,
      platform: "darwin",
      homedir: tmpHome,
      stdout: stdoutCollector,
    });

    const cursor = rows.find((r) => r.client === "cursor");
    expect(cursor?.status).toBe("skipped");

    const updated = JSON.parse(await fs.readFile(cfgPath, "utf-8")) as {
      mcpServers: { hookwarden: { command: string } };
    };
    expect(updated.mcpServers.hookwarden.command).toBe("old-cmd"); // unchanged
  });

  it("Test 5b: --force overwrites existing hookwarden entry", async () => {
    await fs.mkdir(path.join(tmpHome, ".cursor"), { recursive: true });
    const cfgPath = path.join(tmpHome, ".cursor", "mcp.json");
    await fs.writeFile(
      cfgPath,
      JSON.stringify({ mcpServers: { hookwarden: { command: "old-cmd", args: [] } } }),
    );

    await executeInit({
      all: true,
      dryRun: false,
      force: true,
      platform: "darwin",
      homedir: tmpHome,
      stdout: stdoutCollector,
    });

    const updated = JSON.parse(await fs.readFile(cfgPath, "utf-8")) as {
      mcpServers: { hookwarden: { command: string } };
    };
    expect(updated.mcpServers.hookwarden.command).toBe("npx");
  });

  it("Test 8 (negative): malformed JSON → error, original unchanged, exit non-zero", async () => {
    await fs.mkdir(path.join(tmpHome, ".cursor"), { recursive: true });
    const cfgPath = path.join(tmpHome, ".cursor", "mcp.json");
    const garbage = "{this is not JSON";
    await fs.writeFile(cfgPath, garbage);

    const { exitCode, rows } = await executeInit({
      all: true,
      dryRun: false,
      force: false,
      platform: "darwin",
      homedir: tmpHome,
      stdout: stdoutCollector,
    });

    expect(exitCode).not.toBe(0);
    const cursor = rows.find((r) => r.client === "cursor");
    expect(cursor?.status).toBe("error");
    expect(cursor?.error).toContain("config_parse_failed");

    expect(await fs.readFile(cfgPath, "utf-8")).toBe(garbage);
  });
});
