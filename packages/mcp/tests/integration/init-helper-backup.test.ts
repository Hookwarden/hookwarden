// Plan 23-06 Task 2 Tests 4 + 6 — .bak BEFORE mutation + Continue YAML.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { executeInit } from "../../src/init.js";

let tmpHome: string;
let stdout: string;
const stdoutCollector = { write: (chunk: string): void => { stdout += chunk; } };

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "hookwarden-init-backup-"));
  stdout = "";
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe("init helper — backup + Continue YAML", () => {
  it("Test 4: .bak file content equals pre-mutation config content", async () => {
    await fs.mkdir(path.join(tmpHome, ".cursor"), { recursive: true });
    const cfgPath = path.join(tmpHome, ".cursor", "mcp.json");
    const originalContent = JSON.stringify(
      { mcpServers: { filesystem: { command: "fs-mcp", args: [] } } },
      null,
      2,
    );
    await fs.writeFile(cfgPath, originalContent);

    await executeInit({
      all: true,
      dryRun: false,
      force: false,
      platform: "darwin",
      homedir: tmpHome,
      stdout: stdoutCollector,
    });

    const backupContent = await fs.readFile(`${cfgPath}.bak`, "utf-8");
    expect(backupContent).toBe(originalContent);
  });

  it("Test 6: Continue.dev YAML written at per-server path", async () => {
    await fs.mkdir(path.join(tmpHome, ".continue", "mcpServers"), { recursive: true });

    await executeInit({
      all: true,
      dryRun: false,
      force: false,
      platform: "darwin",
      homedir: tmpHome,
      stdout: stdoutCollector,
    });

    const yamlPath = path.join(tmpHome, ".continue", "mcpServers", "hookwarden.yaml");
    const content = await fs.readFile(yamlPath, "utf-8");
    expect(content).toContain("name: hookwarden");
    expect(content).toContain("command: npx");
  });
});
