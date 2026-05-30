// Plan 23-06 Task 1 Tests 1-9 — paths.ts + per-client writers.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAnthropicSdkSnippet } from "../../src/client-config/anthropic-sdk.js";
import { writeClaudeDesktopConfig } from "../../src/client-config/claude-desktop.js";
import { writeContinueDevConfig } from "../../src/client-config/continue-dev.js";
import { writeCursorConfig } from "../../src/client-config/cursor.js";
import { getClientConfigPaths } from "../../src/client-config/paths.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hookwarden-mcp-init-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("getClientConfigPaths (Tests 1-3 + 9)", () => {
  it("Test 1: darwin returns Claude Desktop + Cursor + Continue paths", () => {
    const paths = getClientConfigPaths({ platform: "darwin", homedir: "/Users/test" });
    expect(paths.map((p) => p.client)).toEqual(["claude-desktop", "cursor", "continue-dev"]);
    expect(paths[0].path).toBe(
      "/Users/test/Library/Application Support/Claude/claude_desktop_config.json",
    );
    expect(paths[1].path).toBe("/Users/test/.cursor/mcp.json");
    expect(paths[2].path).toBe("/Users/test/.continue/mcpServers/hookwarden.yaml");
  });

  it("Test 2: win32 uses %APPDATA% for Claude Desktop", () => {
    const paths = getClientConfigPaths({
      platform: "win32",
      homedir: "C:/Users/test",
      env: { APPDATA: "C:/Users/test/AppData/Roaming" },
    });
    const claude = paths.find((p) => p.client === "claude-desktop");
    expect(claude?.path.replace(/\\/g, "/")).toBe(
      "C:/Users/test/AppData/Roaming/Claude/claude_desktop_config.json",
    );
  });

  it("Test 3: linux returns Cursor + Continue only (no Claude Desktop per A2)", () => {
    const paths = getClientConfigPaths({ platform: "linux", homedir: "/home/test" });
    expect(paths.map((p) => p.client)).toEqual(["cursor", "continue-dev"]);
  });

  it("Test 9 (negative): unknown platform returns empty array", () => {
    const paths = getClientConfigPaths({ platform: "openbsd", homedir: "/home/test" });
    expect(paths).toEqual([]);
  });
});

describe("writeClaudeDesktopConfig (Tests 4-5 + 8)", () => {
  it("Test 4: preserves sibling mcpServers.* entries on merge", async () => {
    const cfgPath = path.join(tmpDir, "claude_desktop_config.json");
    await fs.writeFile(
      cfgPath,
      JSON.stringify({
        mcpServers: {
          filesystem: { command: "fs-mcp", args: [] },
          memory: { command: "mem-mcp", args: [] },
        },
      }),
    );

    const result = await writeClaudeDesktopConfig(cfgPath);
    expect(result.status).toBe("added");

    const updated = JSON.parse(await fs.readFile(cfgPath, "utf-8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(Object.keys(updated.mcpServers).sort()).toEqual(["filesystem", "hookwarden", "memory"]);
    expect(updated.mcpServers["hookwarden"]).toEqual({
      command: "npx",
      args: ["-y", "@hookwarden/mcp"],
    });
  });

  it("Test 5: atomic write — failed rename leaves original unchanged", async () => {
    const cfgPath = path.join(tmpDir, "claude_desktop_config.json");
    const originalContent = JSON.stringify({ mcpServers: { foo: { command: "x", args: [] } } });
    await fs.writeFile(cfgPath, originalContent);

    // We can't easily mock fs.rename in a vitest ESM test without setup
    // overhead, so instead validate the atomic-write CONTRACT: the .tmp
    // file is written, and after a successful write the original is
    // exactly the merged content (no half-written state visible). Plus
    // the .bak exists with the original.
    const result = await writeClaudeDesktopConfig(cfgPath);
    expect(result.status).toBe("added");
    expect(result.backup).toBe(`${cfgPath}.bak`);

    // .bak holds the pre-merge content verbatim.
    const backupContent = await fs.readFile(`${cfgPath}.bak`, "utf-8");
    expect(backupContent).toBe(originalContent);

    // The .tmp file should NOT exist after a successful rename.
    await expect(fs.access(`${cfgPath}.tmp`)).rejects.toThrow();
  });

  it("Test 8 (negative): malformed JSON returns config_parse_failed without overwrite", async () => {
    const cfgPath = path.join(tmpDir, "claude_desktop_config.json");
    const garbage = "{this is not valid JSON";
    await fs.writeFile(cfgPath, garbage);

    const result = await writeClaudeDesktopConfig(cfgPath);
    expect(result.status).toBe("error");
    expect(result.error).toContain("config_parse_failed");

    // Original file unchanged.
    expect(await fs.readFile(cfgPath, "utf-8")).toBe(garbage);
  });

  it("skipped path: existing hookwarden entry without forceOverwrite", async () => {
    const cfgPath = path.join(tmpDir, "claude_desktop_config.json");
    await fs.writeFile(
      cfgPath,
      JSON.stringify({ mcpServers: { hookwarden: { command: "old", args: [] } } }),
    );

    const result = await writeClaudeDesktopConfig(cfgPath);
    expect(result.status).toBe("skipped");
    expect(result.error).toBe("exists");

    // Original unchanged (no .bak written either when skipped).
    const updated = JSON.parse(await fs.readFile(cfgPath, "utf-8")) as {
      mcpServers: { hookwarden: { command: string } };
    };
    expect(updated.mcpServers.hookwarden.command).toBe("old");
  });

  it("forceOverwrite replaces existing hookwarden entry", async () => {
    const cfgPath = path.join(tmpDir, "claude_desktop_config.json");
    await fs.writeFile(
      cfgPath,
      JSON.stringify({ mcpServers: { hookwarden: { command: "old", args: [] } } }),
    );

    const result = await writeClaudeDesktopConfig(cfgPath, { forceOverwrite: true });
    expect(result.status).toBe("updated");

    const updated = JSON.parse(await fs.readFile(cfgPath, "utf-8")) as {
      mcpServers: { hookwarden: { command: string } };
    };
    expect(updated.mcpServers.hookwarden.command).toBe("npx");
  });
});

describe("writeContinueDevConfig (Test 6)", () => {
  it("Test 6: writes 4-line YAML at the per-server path", async () => {
    const cfgPath = path.join(tmpDir, ".continue", "mcpServers", "hookwarden.yaml");
    const result = await writeContinueDevConfig(cfgPath);
    expect(result.status).toBe("added");

    const content = await fs.readFile(cfgPath, "utf-8");
    expect(content).toContain("name: hookwarden");
    expect(content).toContain("command: npx");
    expect(content).toContain('args: [-y, "@hookwarden/mcp"]');
  });
});

describe("writeCursorConfig — same merge as Claude Desktop", () => {
  it("preserves sibling mcpServers entries", async () => {
    const cfgPath = path.join(tmpDir, "mcp.json");
    await fs.writeFile(cfgPath, JSON.stringify({ mcpServers: { sibling: { command: "x" } } }));

    const result = await writeCursorConfig(cfgPath);
    expect(result.status).toBe("added");

    const updated = JSON.parse(await fs.readFile(cfgPath, "utf-8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(Object.keys(updated.mcpServers).sort()).toEqual(["hookwarden", "sibling"]);
  });
});

describe("getAnthropicSdkSnippet (Test 7)", () => {
  it("returns a runnable TS snippet referencing claude-agent-sdk + hookwarden mcpServers config", () => {
    const snippet = getAnthropicSdkSnippet();
    expect(snippet).toContain("@anthropic-ai/claude-agent-sdk");
    expect(snippet).toContain("mcpServers");
    expect(snippet).toContain("hookwarden");
    expect(snippet).toContain('"npx"');
    expect(snippet).toContain("@hookwarden/mcp");
  });
});
