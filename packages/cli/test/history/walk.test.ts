// Phase 28 LEAK-05 — history walk orchestrator + the scan-command --history/--since wiring.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runScanCommand } from "../../src/commands/scan.js";
import { CONFIG_DEFAULTS } from "../../src/config/precedence.js";
import { runHistoryScan } from "../../src/history/walk.js";

const dirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d !== undefined) rmSync(d, { recursive: true, force: true });
  }
});

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "hookwarden-walk-"));
  dirs.push(dir);
  git(["init", "-q"], dir);
  git(["config", "user.email", "t@hookwarden.dev"], dir);
  git(["config", "user.name", "Test"], dir);
  git(["config", "commit.gpgsign", "false"], dir);
  return dir;
}

const LEAK_HANDLER = [
  "import express from 'express';",
  "import Stripe from 'stripe';",
  "const app = express();",
  "app.post('/webhooks/stripe', (req, res) => {",
  "  const secret = 'whsec_xyz';",
  "  res.send('ok');",
  "});",
].join("\n");

// Build a repo where a leaking handler is committed, churned around, then deleted before HEAD.
function repoWithDeletedLeak(): string {
  const dir = initRepo();
  writeFileSync(path.join(dir, "util.ts"), "export const n = 1;\n");
  git(["add", "."], dir);
  git(["commit", "-qm", "c0"], dir);

  mkdirSync(path.join(dir, "app"), { recursive: true });
  writeFileSync(path.join(dir, "app", "webhook.ts"), LEAK_HANDLER);
  git(["add", "."], dir);
  git(["commit", "-qm", "add handler"], dir);

  for (let i = 0; i < 3; i++) {
    writeFileSync(path.join(dir, `f${i}.ts`), `export const v${i} = ${i};\n`);
    git(["add", "."], dir);
    git(["commit", "-qm", `churn ${i}`], dir);
  }

  rmSync(path.join(dir, "app", "webhook.ts"));
  git(["add", "-A"], dir);
  git(["commit", "-qm", "remove handler"], dir);
  return dir;
}

describe("runHistoryScan", () => {
  it("finds a committed-then-deleted secret and attaches commit + path provenance", async () => {
    const dir = repoWithDeletedLeak();
    const out = await runHistoryScan({
      rootPath: dir,
      resolvedConfig: CONFIG_DEFAULTS,
      since: null,
      defaultN: 1000,
      verbose: false,
    });
    const leak = out.result.findings.find((f) => f.rule_id === "stripe/hardcoded-secret-prefix");
    expect(leak).toBeDefined();
    expect(leak?.metadata.history_path).toBe("app/webhook.ts");
    expect(typeof leak?.metadata.history_commit).toBe("string");
    expect((leak?.metadata.history_commit as string).length).toBeGreaterThan(0);
    expect(leak?.message).toContain("In git history");
  });

  it("scans each unique blob once — the candidate set is unique blobs, not commit count", async () => {
    const dir = repoWithDeletedLeak(); // 6 commits, but few unique code blobs
    const out = await runHistoryScan({
      rootPath: dir,
      resolvedConfig: CONFIG_DEFAULTS,
      since: null,
      defaultN: 1000,
      verbose: false,
    });
    // util.ts is unchanged across all 6 commits → appears exactly once in the candidate set.
    const utilCandidates = out.walkResult.files.filter((p) => p === "util.ts");
    expect(utilCandidates).toHaveLength(1);
    // Total candidates stay far below the commit count.
    expect(out.walkResult.files.length).toBeLessThan(6);
  });
});

describe("scan --history / --since wiring", () => {
  it("surfaces the deleted secret via the scan command; a plain scan does not", async () => {
    const dir = repoWithDeletedLeak();
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runScanCommand({ path: dir, history: true, format: "json" });
    const historyOut = stdout.mock.calls.map((c) => String(c[0])).join("");
    expect(historyOut).toContain("stripe/hardcoded-secret-prefix");

    stdout.mockClear();
    await runScanCommand({ path: dir, format: "json" });
    const plainOut = stdout.mock.calls.map((c) => String(c[0])).join("");
    expect(plainOut).not.toContain("stripe/hardcoded-secret-prefix");
  });

  it("exits 3 with an actionable error on an empty --since", async () => {
    const dir = initRepo();
    writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
    git(["add", "."], dir);
    git(["commit", "-qm", "c0"], dir);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const code = await runScanCommand({ path: dir, history: true, since: "" });
    expect(code).toBe(3);
    expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toContain("--since");
  });
});
