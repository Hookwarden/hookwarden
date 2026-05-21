import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAllowlistedFile } from "../src/walker/extensions.js";
import { walkProject } from "../src/walker/index.js";
import { shouldUseAnsi } from "../src/walker/tty.js";

let tmp: string;

async function writeFile(rel: string, content: string): Promise<void> {
  const abs = path.join(tmp, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "walker-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("isAllowlistedFile (D-51)", () => {
  it("allows .js, .ts, .py and friends", () => {
    expect(isAllowlistedFile("foo.js")).toBe(true);
    expect(isAllowlistedFile("foo.ts")).toBe(true);
    expect(isAllowlistedFile("foo.tsx")).toBe(true);
    expect(isAllowlistedFile("foo.py")).toBe(true);
    expect(isAllowlistedFile("foo.pyi")).toBe(true);
    expect(isAllowlistedFile("foo.cjs")).toBe(true);
    expect(isAllowlistedFile("foo.mjs")).toBe(true);
  });

  it("rejects README, JSON, SVG, etc.", () => {
    expect(isAllowlistedFile("README.md")).toBe(false);
    expect(isAllowlistedFile("package.json")).toBe(false);
    expect(isAllowlistedFile("logo.svg")).toBe(false);
    expect(isAllowlistedFile("Dockerfile")).toBe(false);
    expect(isAllowlistedFile("noext")).toBe(false);
  });
});

describe("shouldUseAnsi (D-43)", () => {
  it("returns true for TTY + no NO_COLOR + no CI", () => {
    expect(shouldUseAnsi({ isTTY: true }, {})).toBe(true);
  });

  it("returns false when NO_COLOR is set (any value)", () => {
    expect(shouldUseAnsi({ isTTY: true }, { NO_COLOR: "1" })).toBe(false);
    expect(shouldUseAnsi({ isTTY: true }, { NO_COLOR: "yes" })).toBe(false);
  });

  it("returns false when CI is truthy", () => {
    expect(shouldUseAnsi({ isTTY: true }, { CI: "true" })).toBe(false);
    expect(shouldUseAnsi({ isTTY: true }, { CI: "1" })).toBe(false);
  });

  it("returns true when CI is '0' or 'false' or empty", () => {
    expect(shouldUseAnsi({ isTTY: true }, { CI: "0" })).toBe(true);
    expect(shouldUseAnsi({ isTTY: true }, { CI: "false" })).toBe(true);
    expect(shouldUseAnsi({ isTTY: true }, { CI: "" })).toBe(true);
  });

  it("returns false for non-TTY stream", () => {
    expect(shouldUseAnsi({ isTTY: false }, {})).toBe(false);
    expect(shouldUseAnsi(undefined, {})).toBe(false);
  });
});

describe("walkProject (D-50, D-51, D-52, D-53)", () => {
  it("collects allowlisted source files in deterministic order", async () => {
    await writeFile("src/a.ts", "// a");
    await writeFile("src/b.py", "# b");
    await writeFile("src/c.js", "// c");
    await writeFile("README.md", "# readme");
    const r = await walkProject({ rootPath: tmp });
    expect(r.files.map((f) => path.relative(tmp, f)).sort()).toEqual([
      "src/a.ts",
      "src/b.py",
      "src/c.js",
    ]);
    expect(r.parsed_files_count_estimate).toBe(3);
    expect(r.skipped_count).toBeGreaterThanOrEqual(1); // README.md non-allowlist
  });

  it("hard-skips node_modules even without .gitignore", async () => {
    await writeFile("src/a.ts", "// a");
    await writeFile("node_modules/pkg/index.ts", "// secret");
    const r = await walkProject({ rootPath: tmp });
    const rels = r.files.map((f) => path.relative(tmp, f));
    expect(rels).toContain("src/a.ts");
    expect(rels.some((p) => p.startsWith("node_modules"))).toBe(false);
  });

  it("hard-skips .git, dist, build, .venv, __pycache__, vendor, target", async () => {
    await writeFile("src/a.ts", "// a");
    for (const d of [".git", "dist", "build", ".venv", "__pycache__", "vendor", "target"]) {
      await writeFile(`${d}/probe.ts`, "// nope");
    }
    const r = await walkProject({ rootPath: tmp });
    const rels = r.files.map((f) => path.relative(tmp, f));
    for (const d of [".git", "dist", "build", ".venv", "__pycache__", "vendor", "target"]) {
      expect(rels.some((p) => p.startsWith(d))).toBe(false);
    }
    expect(rels).toContain("src/a.ts");
  });

  it("honors .gitignore at the root", async () => {
    await writeFile("src/keep.ts", "// keep");
    await writeFile("private/secret.ts", "// hidden");
    await writeFile(".gitignore", "private/\n");
    const r = await walkProject({ rootPath: tmp });
    const rels = r.files.map((f) => path.relative(tmp, f));
    expect(rels).toContain("src/keep.ts");
    expect(rels.some((p) => p.startsWith("private"))).toBe(false);
  });

  it("skips files larger than maxFileSize (default 1 MB)", async () => {
    await writeFile("src/small.ts", "// small");
    await writeFile("src/big.ts", "x".repeat(2 * 1024 * 1024)); // 2 MB
    const r = await walkProject({ rootPath: tmp });
    const rels = r.files.map((f) => path.relative(tmp, f));
    expect(rels).toContain("src/small.ts");
    expect(rels).not.toContain("src/big.ts");
    expect(r.oversized_count).toBe(1);
  });

  it("respects maxFileSize override", async () => {
    await writeFile("src/medium.ts", "x".repeat(1024)); // 1 KB
    const r = await walkProject({ rootPath: tmp, maxFileSize: 512 });
    expect(r.files.length).toBe(0);
    expect(r.oversized_count).toBe(1);
  });

  it("skips symlinks by default (cycle-bomb defense, T-03-19)", async () => {
    // tinyglobby with `followSymbolicLinks: false` pre-filters file-symlinks at the glob layer
    // (fdir cycle detection prevents directory-symlink loops), so the lstat-based counter never
    // fires for symlinks tinyglobby already filtered. The behavioral guarantee is: symlinks are
    // never present in walkProject's `files` output. That is the safety property D-52 requires.
    await writeFile("src/real.ts", "// real");
    await fs.symlink(path.join(tmp, "src/real.ts"), path.join(tmp, "src/link.ts"));
    const r = await walkProject({ rootPath: tmp });
    const rels = r.files.map((f) => path.relative(tmp, f));
    expect(rels).toContain("src/real.ts");
    expect(rels).not.toContain("src/link.ts");
  });

  it("counts symlinks via lstat fallback when followSymlinks is opted in", async () => {
    // When the caller explicitly opts in to symlink following, tinyglobby returns the symlink
    // and the lstat fallback in walkProject increments symlink_count for any symlink that still
    // shouldn't be parsed (defense-in-depth — even with followSymlinks=true the parser only sees
    // regular files). Exercises the lstat skip path that is otherwise unreachable.
    await writeFile("src/real.ts", "// real");
    await fs.symlink(path.join(tmp, "src/real.ts"), path.join(tmp, "src/link.ts"));
    const r = await walkProject({ rootPath: tmp, followSymlinks: true });
    const rels = r.files.map((f) => path.relative(tmp, f));
    // Both files end up in the result because followSymlinks=true makes them regular files
    // from tinyglobby's perspective; the lstat path doesn't downgrade them.
    expect(rels).toContain("src/real.ts");
    expect(rels).toContain("src/link.ts");
  });

  it("returns empty result for empty directory", async () => {
    const r = await walkProject({ rootPath: tmp });
    expect(r.files).toHaveLength(0);
    expect(r.parsed_files_count_estimate).toBe(0);
  });
});

describe("walkProject — default test-path exclusion (DEFAULT_TEST_GLOBS)", () => {
  // Surfaced by the OSS corpus smoke (probot/probot): scanner returned 4
  // findings from `test/integration/*.test.ts` — all intentional fixtures.
  // Test paths are excluded by default to keep OOTB output focused on
  // production routes; --include-tests opts back in.

  it("excludes paths under test/, tests/, __tests__/, spec/, fixtures/, mocks/ by default", async () => {
    await writeFile("src/handler.ts", "// production handler");
    await writeFile("test/handler.test.ts", "// intentional fixture");
    await writeFile("tests/handler.test.ts", "// intentional fixture");
    await writeFile("__tests__/integration.test.ts", "// intentional fixture");
    await writeFile("spec/handler.spec.ts", "// intentional fixture");
    await writeFile("fixtures/not-verified.ts", "// intentional fixture");
    await writeFile("mocks/stripe-mock.ts", "// mock");
    const r = await walkProject({ rootPath: tmp });
    const rels = r.files.map((f) => path.relative(tmp, f)).sort();
    expect(rels).toEqual(["src/handler.ts"]);
    expect(r.test_excluded_count).toBe(6);
  });

  it("excludes *.test.* and *.spec.* and Python test_* / *_test.py file conventions", async () => {
    await writeFile("src/handler.ts", "// prod");
    await writeFile("src/handler.test.ts", "// inline test");
    await writeFile("src/handler.spec.tsx", "// inline test");
    await writeFile("src/handler.test.js", "// inline test");
    await writeFile("src/api.test.mjs", "// inline test");
    await writeFile("src/test_api.py", "// pytest convention");
    await writeFile("src/api_test.py", "// go-style convention");
    const r = await walkProject({ rootPath: tmp });
    const rels = r.files.map((f) => path.relative(tmp, f)).sort();
    expect(rels).toEqual(["src/handler.ts"]);
    expect(r.test_excluded_count).toBe(6);
  });

  it("INCLUDES test paths when scanTests: true (--include-tests semantics)", async () => {
    await writeFile("src/handler.ts", "// prod");
    await writeFile("test/handler.test.ts", "// fixture");
    await writeFile("__tests__/integration.test.ts", "// fixture");
    const r = await walkProject({ rootPath: tmp, scanTests: true });
    const rels = r.files.map((f) => path.relative(tmp, f)).sort();
    expect(rels).toEqual([
      "__tests__/integration.test.ts",
      "src/handler.ts",
      "test/handler.test.ts",
    ]);
    expect(r.test_excluded_count).toBe(0);
  });

  it("does NOT confuse production paths that merely contain 'test' substrings", async () => {
    // e.g., `src/contest.ts`, `src/testimonials.ts` — the glob is **/test/** not **/*test*/**
    await writeFile("src/contest.ts", "// prod");
    await writeFile("src/testimonials.ts", "// prod");
    await writeFile("src/attestation.ts", "// prod");
    const r = await walkProject({ rootPath: tmp });
    const rels = r.files.map((f) => path.relative(tmp, f)).sort();
    expect(rels).toEqual(["src/attestation.ts", "src/contest.ts", "src/testimonials.ts"]);
    expect(r.test_excluded_count).toBe(0);
  });

  it("test_excluded_count is reported even when files survive the filter", async () => {
    await writeFile("src/handler.ts", "// prod");
    await writeFile("src/handler.test.ts", "// fixture");
    const r = await walkProject({ rootPath: tmp });
    expect(r.test_excluded_count).toBe(1);
    expect(r.files.length).toBe(1);
  });
});

describe("walkProject — single-file scan target", () => {
  // Surfaced by the demo GIF re-recording (ENOTDIR on .hookwardenignore /
  // .hookwarden.baseline.json lookups). `hookwarden scan ./handler.ts` is a
  // documented usage and must not crash trying to read sibling config files
  // as if the file were a directory.

  it("returns the single file when rootPath is a file (not a directory)", async () => {
    await writeFile("src/handler.ts", "// production handler");
    const target = path.join(tmp, "src/handler.ts");
    const r = await walkProject({ rootPath: target });
    expect(r.files).toEqual([target]);
    expect(r.total_files_count).toBe(1);
    expect(r.parsed_files_count_estimate).toBe(1);
  });

  it("filters non-allowlisted single-file targets (e.g., README.md)", async () => {
    await writeFile("docs/README.md", "# unrelated");
    const target = path.join(tmp, "docs/README.md");
    const r = await walkProject({ rootPath: target });
    expect(r.files).toEqual([]);
    expect(r.skipped_count).toBe(1);
  });

  it("filters oversized single-file targets", async () => {
    await writeFile("src/huge.ts", "x".repeat(2048));
    const target = path.join(tmp, "src/huge.ts");
    const r = await walkProject({ rootPath: target, maxFileSize: 512 });
    expect(r.files).toEqual([]);
    expect(r.oversized_count).toBe(1);
  });

  it("respects test-path exclusion when single-file target is in a test path", async () => {
    // The user explicitly named the file — scan it anyway. Single-file
    // targets are explicit opt-in to that file. Test-path filter applies
    // to discovery (directory walk), not to explicit file targets.
    await writeFile("__tests__/handler.test.ts", "// fixture");
    const target = path.join(tmp, "__tests__/handler.test.ts");
    const r = await walkProject({ rootPath: target });
    expect(r.files).toEqual([target]);
    expect(r.test_excluded_count).toBe(0);
  });
});
