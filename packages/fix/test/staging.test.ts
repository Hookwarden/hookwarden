// Phase 8.2 Plan 05 Task 1: atomic-write staging + gitignore management.
// The "failure-preserves-staging" test is the SOC2-auditor-facing evidence
// that the D-20 inspection contract holds.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  commitStaging,
  createStagingRun,
  ensureGitignoreEntry,
  stageFile,
  type StagingRun,
} from "../src/staging.js";

let tempRepo: string;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let stderrWrites: string[];

beforeEach(async () => {
  tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), "staging-test-"));
  stderrWrites = [];
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderrWrites.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  });
});

afterEach(async () => {
  stderrSpy.mockRestore();
  await fs.rm(tempRepo, { recursive: true, force: true });
});

describe("createStagingRun", () => {
  it("returns a StagingRun with the expected runId format + empty stagedFiles", async () => {
    const run = await createStagingRun(tempRepo);
    expect(run.runId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-[0-9a-f]{4}$/);
    expect(run.stagedFiles).toEqual([]);
    expect(run.stagingDir).toBe(path.join(tempRepo, ".hookwarden-fix-staging", run.runId));
    await expect(fs.access(run.stagingDir)).resolves.not.toThrow();
  });

  it("two calls in tight loop produce distinct runIds (collision-resistant)", async () => {
    const [a, b] = await Promise.all([createStagingRun(tempRepo), createStagingRun(tempRepo)]);
    expect(a.runId).not.toBe(b.runId);
  });
});

describe("stageFile + commitStaging — atomic rename", () => {
  it("stages and commits a single file", async () => {
    const src = "const x = 1;\n";
    const after = "const x = 2;\n";
    const rel = "src/foo.ts";
    const full = path.join(tempRepo, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, src);
    const run = await createStagingRun(tempRepo);
    await stageFile(run, rel, after);
    await commitStaging(run);
    expect(await fs.readFile(full, "utf-8")).toBe(after);
  });

  it("stages and commits 3 files atomically per-file", async () => {
    const run = await createStagingRun(tempRepo);
    for (const i of [1, 2, 3]) {
      const rel = `src/f${i}.ts`;
      const full = path.join(tempRepo, rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, `old ${i}\n`);
      await stageFile(run, rel, `new ${i}\n`);
    }
    await commitStaging(run);
    for (const i of [1, 2, 3]) {
      expect(await fs.readFile(path.join(tempRepo, `src/f${i}.ts`), "utf-8")).toBe(`new ${i}\n`);
    }
  });

  it("stageFile throws TypeError on non-string newContents", async () => {
    const run = await createStagingRun(tempRepo);
    await expect(
      stageFile(run, "foo.ts", 123 as unknown as string),
    ).rejects.toThrow(TypeError);
  });
});

describe("commitStaging — D-20 inspection contract on failure", () => {
  it("staging dir PERSISTS when commitStaging throws (original missing)", async () => {
    const rel = "src/missing.ts";
    const run = await createStagingRun(tempRepo);
    await stageFile(run, rel, "new contents\n");
    // We never wrote the original file. fs.rename will succeed on POSIX (rename
    // doesn't require target to exist). To force a failure, point `from` at a
    // path inside a non-existent directory.
    (run.stagedFiles as Array<{ from: string; staged: string; rel: string }>)[0]!.from =
      path.join(tempRepo, "non-existent-dir", "x.ts");
    await expect(commitStaging(run)).rejects.toThrow();
    // D-20: staging dir survives so the user can inspect.
    await expect(fs.access(run.stagingDir)).resolves.not.toThrow();
  });
});

describe("ensureGitignoreEntry", () => {
  it("creates .gitignore when missing + writes loud notice to stderr", async () => {
    const result = await ensureGitignoreEntry(tempRepo);
    expect(result.added).toBe(true);
    const gitignore = await fs.readFile(path.join(tempRepo, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".hookwarden-fix-staging/");
    expect(stderrWrites.join("")).toContain("Added .hookwarden-fix-staging/ to .gitignore");
  });

  it("appends to existing .gitignore that lacks the line", async () => {
    await fs.writeFile(path.join(tempRepo, ".gitignore"), "node_modules/\n");
    const result = await ensureGitignoreEntry(tempRepo);
    expect(result.added).toBe(true);
    const gitignore = await fs.readFile(path.join(tempRepo, ".gitignore"), "utf-8");
    expect(gitignore).toContain("node_modules/");
    expect(gitignore).toContain(".hookwarden-fix-staging/");
  });

  it("is no-op when .hookwarden-fix-staging/ is already present", async () => {
    await fs.writeFile(
      path.join(tempRepo, ".gitignore"),
      ".hookwarden-fix-staging/\nnode_modules/\n",
    );
    const result = await ensureGitignoreEntry(tempRepo);
    expect(result.added).toBe(false);
    expect(stderrWrites.join("")).toBe("");
  });

  it("matches the gitignore line with leading slash variant (/.hookwarden-fix-staging/)", async () => {
    await fs.writeFile(path.join(tempRepo, ".gitignore"), "/.hookwarden-fix-staging/\n");
    const result = await ensureGitignoreEntry(tempRepo);
    expect(result.added).toBe(false);
  });

  it("matches the gitignore line without trailing slash (.hookwarden-fix-staging)", async () => {
    await fs.writeFile(path.join(tempRepo, ".gitignore"), ".hookwarden-fix-staging\n");
    const result = await ensureGitignoreEntry(tempRepo);
    expect(result.added).toBe(false);
  });
});
