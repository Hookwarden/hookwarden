// Phase 28 LEAK-05 — deleted-inclusive git-history blob walk.
// Builds throwaway tmpdir repos with the runGit-style array-arg discipline and asserts:
//  - a committed-then-deleted secret blob IS enumerated by gitHistoryBlobs
//  - the existing ACMR diff path does NOT include it (proves the gap + off-by-default contract)
//  - resolveHistoryRange branches ref-vs-date and clamps the default to root
//  - binary blobs are classified out

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gitDiffNames, gitHistoryBlobs, resolveHistoryRange } from "../../src/diff/git.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d !== undefined) rmSync(d, { recursive: true, force: true });
  }
});

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

function revParse(ref: string, cwd: string): string {
  return execFileSync("git", ["rev-parse", ref], { cwd, encoding: "utf8" }).trim();
}

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "hookwarden-hist-"));
  dirs.push(dir);
  git(["init", "-q"], dir);
  git(["config", "user.email", "t@hookwarden.dev"], dir);
  git(["config", "user.name", "Test"], dir);
  git(["config", "commit.gpgsign", "false"], dir);
  return dir;
}

// A minimal Stripe webhook handler carrying a hardcoded `whsec_` signing secret — the engine's
// secret_literal_match fires only inside detected handler text, so the blob must look like one.
const LEAK_HANDLER = [
  "import express from 'express';",
  "import Stripe from 'stripe';",
  "const app = express();",
  "app.post('/webhooks/stripe', (req, res) => {",
  "  const secret = 'whsec_xyz';",
  "  res.send('ok');",
  "});",
].join("\n");

describe("gitHistoryBlobs", () => {
  it("enumerates a committed-then-deleted blob that the ACMR diff path excludes", () => {
    const dir = initRepo();
    writeFileSync(path.join(dir, "keep.ts"), "export const x = 1;\n");
    git(["add", "."], dir);
    git(["commit", "-qm", "c0"], dir);
    const base = revParse("HEAD", dir);

    mkdirSync(path.join(dir, "app"), { recursive: true });
    writeFileSync(path.join(dir, "app", "webhook.ts"), LEAK_HANDLER);
    git(["add", "."], dir);
    git(["commit", "-qm", "add leak"], dir);

    rmSync(path.join(dir, "app", "webhook.ts"));
    git(["add", "-A"], dir);
    git(["commit", "-qm", "delete leak"], dir);

    writeFileSync(path.join(dir, "after.ts"), "export const y = 2;\n");
    git(["add", "."], dir);
    git(["commit", "-qm", "c3"], dir);

    const range = resolveHistoryRange(null, 1000, dir);
    const blobs = gitHistoryBlobs(range, dir);
    const leak = blobs.find((b) => b.path === "app/webhook.ts");
    expect(leak).toBeDefined();
    expect(leak?.text).toContain("whsec_xyz");

    // The existing ACMR path (base..HEAD) net-excludes the added-then-deleted file (filter D).
    const acmr = gitDiffNames(base, dir);
    expect(acmr).not.toContain("app/webhook.ts");
  });

  it("dedups identical content — a file unchanged across many commits yields one blob", () => {
    const dir = initRepo();
    writeFileSync(path.join(dir, "stable.ts"), "export const n = 1;\n");
    git(["add", "."], dir);
    git(["commit", "-qm", "c0"], dir);
    // Five more commits that never touch stable.ts.
    for (let i = 0; i < 5; i++) {
      writeFileSync(path.join(dir, `churn${i}.ts`), `export const v${i} = ${i};\n`);
      git(["add", "."], dir);
      git(["commit", "-qm", `churn ${i}`], dir);
    }
    const range = resolveHistoryRange(null, 1000, dir);
    const blobs = gitHistoryBlobs(range, dir);
    const stableHits = blobs.filter((b) => b.path === "stable.ts");
    expect(stableHits).toHaveLength(1); // content-addressed dedup — not once per commit
  });

  it("classifies binary blobs out via the extension allowlist", () => {
    const dir = initRepo();
    writeFileSync(path.join(dir, "code.ts"), "export const ok = 1;\n");
    // A non-allowlisted extension carrying NUL bytes — must never reach a text parser.
    writeFileSync(path.join(dir, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    git(["add", "."], dir);
    git(["commit", "-qm", "c0"], dir);

    const range = resolveHistoryRange(null, 1000, dir);
    const blobs = gitHistoryBlobs(range, dir);
    expect(blobs.some((b) => b.path === "code.ts")).toBe(true);
    expect(blobs.some((b) => b.path === "image.png")).toBe(false);
  });
});

describe("resolveHistoryRange", () => {
  it("returns the whole history (clamped to root) when commit count <= default bound", () => {
    const dir = initRepo();
    writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
    git(["add", "."], dir);
    git(["commit", "-qm", "c0"], dir);
    expect(resolveHistoryRange(null, 1000, dir)).toEqual(["HEAD"]);
  });

  it("branches to <ref>..HEAD when --since resolves as a git ref", () => {
    const dir = initRepo();
    writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
    git(["add", "."], dir);
    git(["commit", "-qm", "c0"], dir);
    const base = revParse("HEAD", dir);
    writeFileSync(path.join(dir, "b.ts"), "export const b = 2;\n");
    git(["add", "."], dir);
    git(["commit", "-qm", "c1"], dir);
    expect(resolveHistoryRange(base, 1000, dir)).toEqual([`${base}..HEAD`]);
  });

  it("branches to --since=<date> when --since is not a ref", () => {
    const dir = initRepo();
    writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
    git(["add", "."], dir);
    git(["commit", "-qm", "c0"], dir);
    expect(resolveHistoryRange("2020-01-01", 1000, dir)).toEqual(["--since=2020-01-01", "HEAD"]);
  });

  it("throws on an empty --since value", () => {
    const dir = initRepo();
    writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
    git(["add", "."], dir);
    git(["commit", "-qm", "c0"], dir);
    expect(() => resolveHistoryRange("   ", 1000, dir)).toThrow(/non-empty/);
  });
});
