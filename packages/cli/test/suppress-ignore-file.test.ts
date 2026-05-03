import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadHookwardenIgnore } from "../src/suppress/ignore-file.js";

const tempRoots: string[] = [];

async function makeRootWith(content: string | null): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hookwarden-ig-"));
  tempRoots.push(dir);
  if (content !== null) {
    await fs.writeFile(path.join(dir, ".hookwardenignore"), content);
  }
  return dir;
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const dir = tempRoots.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("loadHookwardenIgnore", () => {
  it("returns null when no .hookwardenignore exists", async () => {
    const dir = await makeRootWith(null);
    expect(await loadHookwardenIgnore(dir)).toBeNull();
  });

  it("returns an empty filter for an empty file", async () => {
    const dir = await makeRootWith("");
    const filter = await loadHookwardenIgnore(dir);
    expect(filter).not.toBeNull();
    expect(filter?.patterns).toHaveLength(0);
    expect(filter?.matches("foo.ts")).toBeNull();
    expect(filter?.matchesAll("foo.ts")).toEqual([]);
  });

  it("matches positive patterns and returns the matched pattern", async () => {
    const dir = await makeRootWith("**/*.test.ts\n");
    const filter = await loadHookwardenIgnore(dir);
    expect(filter?.matches("a/b.test.ts")).toBe("**/*.test.ts");
    expect(filter?.matches("a/b.ts")).toBeNull();
    expect(filter?.matchesAll("a/b.test.ts")).toEqual(["**/*.test.ts"]);
  });

  it("supports directory glob patterns", async () => {
    const dir = await makeRootWith("vendor/**\n");
    const filter = await loadHookwardenIgnore(dir);
    expect(filter?.matches("vendor/lib.ts")).toBe("vendor/**");
  });

  it("respects negation patterns", async () => {
    const dir = await makeRootWith("**/*.test.ts\n!__keep__.test.ts\n");
    const filter = await loadHookwardenIgnore(dir);
    expect(filter?.matches("__keep__.test.ts")).toBeNull();
    expect(filter?.matches("a.test.ts")).toBe("**/*.test.ts");
  });

  it("ignores comment and blank lines", async () => {
    const dir = await makeRootWith("# this is a comment\n\nvendor/**\n");
    const filter = await loadHookwardenIgnore(dir);
    expect(filter?.patterns).toEqual(["vendor/**"]);
  });

  it("matches() returns the LAST matching positive pattern", async () => {
    const dir = await makeRootWith("vendor/**\nvendor/lib.ts\n");
    const filter = await loadHookwardenIgnore(dir);
    expect(filter?.matches("vendor/lib.ts")).toBe("vendor/lib.ts");
  });

  it("matchesAll() returns ALL matching positive patterns", async () => {
    const dir = await makeRootWith("vendor/**\nvendor/lib.ts\n");
    const filter = await loadHookwardenIgnore(dir);
    expect(filter?.matchesAll("vendor/lib.ts")).toEqual(["vendor/**", "vendor/lib.ts"]);
  });

  it("matchesAll() returns empty when negation cancels the match", async () => {
    const dir = await makeRootWith("vendor/**\n!vendor/keep.ts\n");
    const filter = await loadHookwardenIgnore(dir);
    expect(filter?.matchesAll("vendor/keep.ts")).toEqual([]);
    expect(filter?.matchesAll("vendor/lib.ts")).toEqual(["vendor/**"]);
  });
});
