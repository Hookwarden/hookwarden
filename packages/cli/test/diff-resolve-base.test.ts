import { execFileSync } from "node:child_process";
import { promises as fs, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveBaseRef } from "../src/diff/resolve-base.js";

const tempRoots: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hookwarden-resolve-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const dir = tempRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const emptyEnv = {} as NodeJS.ProcessEnv;

describe("resolveBaseRef", () => {
  it("returns explicit flag when present", () => {
    const dir = makeTempDir();
    expect(resolveBaseRef({ explicitFlag: "main", env: emptyEnv, cwd: dir })).toEqual({
      ref: "main",
      source: "flag",
    });
  });

  it("uses GITHUB_BASE_REF and prefixes origin/", () => {
    const dir = makeTempDir();
    const env = { GITHUB_BASE_REF: "develop" } as NodeJS.ProcessEnv;
    expect(resolveBaseRef({ env, cwd: dir })).toEqual({
      ref: "origin/develop",
      source: "github",
    });
  });

  it("uses BUILDKITE_PULL_REQUEST_BASE_BRANCH", () => {
    const dir = makeTempDir();
    const env = { BUILDKITE_PULL_REQUEST_BASE_BRANCH: "trunk" } as NodeJS.ProcessEnv;
    expect(resolveBaseRef({ env, cwd: dir }).ref).toBe("origin/trunk");
  });

  it("uses CI_MERGE_REQUEST_TARGET_BRANCH_NAME", () => {
    const dir = makeTempDir();
    const env = { CI_MERGE_REQUEST_TARGET_BRANCH_NAME: "stable" } as NodeJS.ProcessEnv;
    expect(resolveBaseRef({ env, cwd: dir }).ref).toBe("origin/stable");
  });

  it("GITHUB_BASE_REF takes precedence over BUILDKITE", () => {
    const dir = makeTempDir();
    const env = {
      GITHUB_BASE_REF: "gh",
      BUILDKITE_PULL_REQUEST_BASE_BRANCH: "bk",
    } as NodeJS.ProcessEnv;
    expect(resolveBaseRef({ env, cwd: dir }).ref).toBe("origin/gh");
  });

  it("BUILDKITE takes precedence over CI_MERGE_REQUEST", () => {
    const dir = makeTempDir();
    const env = {
      BUILDKITE_PULL_REQUEST_BASE_BRANCH: "bk",
      CI_MERGE_REQUEST_TARGET_BRANCH_NAME: "gl",
    } as NodeJS.ProcessEnv;
    expect(resolveBaseRef({ env, cwd: dir }).ref).toBe("origin/bk");
  });

  it("falls through to merge-base when origin/HEAD is set in a real repo", async () => {
    const dir = makeTempDir();
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
    execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
    writeFileSync(path.join(dir, "a.txt"), "hi\n");
    execFileSync("git", ["add", "a.txt"], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
    // Fake an origin/HEAD by pointing it at the local branch.
    await fs.mkdir(path.join(dir, ".git", "refs", "remotes", "origin"), { recursive: true });
    await fs.writeFile(
      path.join(dir, ".git", "refs", "remotes", "origin", "main"),
      execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }),
    );
    execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], {
      cwd: dir,
    });

    const result = resolveBaseRef({ env: emptyEnv, cwd: dir });
    expect(result.source).toBe("merge-base");
    expect(result.ref).toMatch(/^[0-9a-f]{40}$/);
  });

  it("falls through to HEAD~1 when no env signals and no git tree", () => {
    const dir = makeTempDir();
    const result = resolveBaseRef({ env: emptyEnv, cwd: dir });
    expect(result).toEqual({ ref: "HEAD~1", source: "head~1" });
  });

  it("explicit flag wins over every env var", () => {
    const dir = makeTempDir();
    const env = {
      GITHUB_BASE_REF: "x",
      BUILDKITE_PULL_REQUEST_BASE_BRANCH: "y",
      CI_MERGE_REQUEST_TARGET_BRANCH_NAME: "z",
    } as NodeJS.ProcessEnv;
    expect(resolveBaseRef({ explicitFlag: "release/v1", env, cwd: dir }).ref).toBe("release/v1");
  });
});
