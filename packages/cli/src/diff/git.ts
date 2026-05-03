// D-72/D-74 git shell-out helpers. execFileSync with array args (injection-safe).
// Always use execFileSync with array args (NEVER string interpolation) — base ref values come
// from CLI/env and could contain shell metacharacters.

import { execFileSync } from "node:child_process";

export class GitNotInWorkTreeError extends Error {
  constructor(message = "--diff-only requires a git working tree") {
    super(message);
    this.name = "GitNotInWorkTreeError";
  }
}

function runGit(args: ReadonlyArray<string>, cwd: string): string {
  try {
    return execFileSync("git", args as string[], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const stderr = (err as NodeJS.ErrnoException & { stderr?: Buffer | string }).stderr;
    const text = typeof stderr === "string" ? stderr : (stderr?.toString("utf8") ?? "");
    if (text.includes("not a git repository")) {
      throw new GitNotInWorkTreeError();
    }
    throw err;
  }
}

export function isInsideWorkTree(cwd: string): boolean {
  try {
    const out = runGit(["rev-parse", "--is-inside-work-tree"], cwd).trim();
    return out === "true";
  } catch {
    return false;
  }
}

function parseNameOnlyOutput(raw: string): string[] {
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function gitDiffNames(base: string, cwd: string): string[] {
  const out = runGit(["diff", "--name-only", "--diff-filter=ACMR", base, "HEAD"], cwd);
  return parseNameOnlyOutput(out);
}

export function gitDiffNamesUnstaged(cwd: string): string[] {
  const out = runGit(["diff", "--name-only", "--diff-filter=ACMR", "HEAD"], cwd);
  return parseNameOnlyOutput(out);
}

export function gitDiffNamesStaged(cwd: string): string[] {
  const out = runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "HEAD"], cwd);
  return parseNameOnlyOutput(out);
}

export function gitSymbolicRefOriginHead(cwd: string): string {
  const out = runGit(["symbolic-ref", "refs/remotes/origin/HEAD"], cwd).trim();
  const prefix = "refs/remotes/";
  if (out.startsWith(prefix)) return out.slice(prefix.length);
  throw new Error(`unexpected symbolic-ref output: ${out}`);
}

export function gitMergeBaseOriginHead(cwd: string): string {
  const head = gitSymbolicRefOriginHead(cwd);
  return runGit(["merge-base", "HEAD", head], cwd).trim();
}
