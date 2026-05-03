import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { changedFiles } from "../src/diff/changed-files.js";

const tempRoots: string[] = [];

function setupRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hookwarden-diff-"));
  tempRoots.push(dir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  return dir;
}

function commit(dir: string, file: string, content: string, msg: string): void {
  writeFileSync(path.join(dir, file), content);
  execFileSync("git", ["add", file], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", msg], { cwd: dir });
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const dir = tempRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("changedFiles (D-74 working-tree union)", () => {
  it("includes a committed-vs-base modified file", () => {
    const dir = setupRepo();
    commit(dir, "a.txt", "v1\n", "init");
    commit(dir, "a.txt", "v2\n", "modify");
    const result = changedFiles("HEAD~1", dir);
    expect(result.has("a.txt")).toBe(true);
  });

  it("includes a staged-but-not-committed file", () => {
    const dir = setupRepo();
    commit(dir, "a.txt", "v1\n", "init");
    writeFileSync(path.join(dir, "b.txt"), "new\n");
    execFileSync("git", ["add", "b.txt"], { cwd: dir });
    const result = changedFiles("HEAD", dir);
    expect(result.has("b.txt")).toBe(true);
  });

  it("includes an unstaged-uncommitted-but-tracked file", () => {
    const dir = setupRepo();
    commit(dir, "a.txt", "v1\n", "init");
    writeFileSync(path.join(dir, "a.txt"), "v2\n");
    const result = changedFiles("HEAD", dir);
    expect(result.has("a.txt")).toBe(true);
  });

  it("excludes untracked files (D-74 explicit exclusion)", () => {
    const dir = setupRepo();
    commit(dir, "a.txt", "v1\n", "init");
    writeFileSync(path.join(dir, "untracked.txt"), "new\n");
    const result = changedFiles("HEAD", dir);
    expect(result.has("untracked.txt")).toBe(false);
  });

  it("excludes deleted files (ACMR filter)", () => {
    const dir = setupRepo();
    commit(dir, "a.txt", "v1\n", "init");
    commit(dir, "b.txt", "v1\n", "add b");
    unlinkSync(path.join(dir, "b.txt"));
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "delete b"], { cwd: dir });
    const result = changedFiles("HEAD~1", dir);
    expect(result.has("b.txt")).toBe(false);
  });

  it("returns each file once even when present in committed + staged + unstaged", () => {
    const dir = setupRepo();
    commit(dir, "a.txt", "v1\n", "init");
    commit(dir, "a.txt", "v2\n", "modify"); // committed-vs-base
    writeFileSync(path.join(dir, "a.txt"), "v3\n"); // unstaged
    execFileSync("git", ["add", "a.txt"], { cwd: dir }); // staged
    writeFileSync(path.join(dir, "a.txt"), "v4\n"); // unstaged again
    const result = changedFiles("HEAD~1", dir);
    expect([...result].filter((f) => f === "a.txt")).toHaveLength(1);
  });

  it("returns an empty set when no changes vs HEAD", () => {
    const dir = setupRepo();
    commit(dir, "a.txt", "v1\n", "init");
    const result = changedFiles("HEAD", dir);
    expect(result.size).toBe(0);
  });
});
