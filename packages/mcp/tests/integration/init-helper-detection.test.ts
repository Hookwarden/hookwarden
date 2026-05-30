// Plan 23-06 Task 2 Tests 1 + 7 — init helper client detection + dry-run.

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
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "hookwarden-init-detect-"));
  _stdout = "";
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe("init helper — detection (Test 1)", () => {
  it("detects only clients whose parent dir exists; shows others as not-detected", async () => {
    // Only Cursor dir exists.
    await fs.mkdir(path.join(tmpHome, ".cursor"), { recursive: true });

    const { exitCode, rows } = await executeInit({
      all: true,
      dryRun: true,
      force: false,
      platform: "darwin",
      homedir: tmpHome,
      stdout: stdoutCollector,
    });

    expect(exitCode).toBe(0);

    const cursor = rows.find((r) => r.client === "cursor");
    const claude = rows.find((r) => r.client === "claude-desktop");
    expect(cursor?.status).toBe("added");
    expect(claude?.status).toBe("not-detected");
  });

  it("Test 7 (negative — dry-run): no files (including .bak) written to disk", async () => {
    await fs.mkdir(path.join(tmpHome, ".cursor"), { recursive: true });

    await executeInit({
      all: true,
      dryRun: true,
      force: false,
      platform: "darwin",
      homedir: tmpHome,
      stdout: stdoutCollector,
    });

    // mcp.json should NOT have been created in dry-run mode.
    await expect(fs.access(path.join(tmpHome, ".cursor", "mcp.json"))).rejects.toThrow();
    await expect(fs.access(path.join(tmpHome, ".cursor", "mcp.json.bak"))).rejects.toThrow();
  });
});
