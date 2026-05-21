// D-50, D-51, D-52, D-53: filesystem walker for the CLI. CLI is the I/O boundary (engine is pure).
// Honors .gitignore + .git/info/exclude AT THE ROOT, plus an unconditional hard-skip list applied
// as a directory-name match before descending. Skips symlinks. Skips files larger than maxFileSize
// (default 1 MB). Bounded concurrency via p-limit.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import ignore, { type Ignore } from "ignore";
import pLimit from "p-limit";
import { glob } from "tinyglobby";
import { isAllowlistedFile } from "./extensions.js";

const HARD_SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  "vendor",
  "target",
  ".git",
]);

const HARD_SKIP_GLOBS: ReadonlyArray<string> = [...HARD_SKIP_DIRS].map((d) => `**/${d}/**`);

// Default test/fixture path globs — excluded by default unless `scanTests` is true.
// Rationale: an OOTB hookwarden scan on a typical Node/Python project should not
// drown the user in findings on intentional test fixtures (handlers deliberately
// missing verification to exercise the test harness). Real production routes
// almost never live under these paths. User can opt in with --include-tests
// (CLI) or `scan_tests: true` (config) when they want to audit test code too.
const DEFAULT_TEST_GLOBS: ReadonlyArray<string> = [
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/__test__/**",
  "**/spec/**",
  "**/specs/**",
  "**/__spec__/**",
  "**/__specs__/**",
  "**/e2e/**",
  "**/fixtures/**",
  "**/__fixtures__/**",
  "**/mocks/**",
  "**/__mocks__/**",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.test.js",
  "**/*.test.jsx",
  "**/*.test.mjs",
  "**/*.test.cjs",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/*.spec.js",
  "**/*.spec.jsx",
  "**/*.spec.mjs",
  "**/*.spec.cjs",
  "**/test_*.py",
  "**/*_test.py",
];

export interface WalkOptions {
  readonly rootPath: string;
  readonly concurrency?: number;
  readonly maxFileSize?: number; // bytes; default 1 MB per D-52
  readonly followSymlinks?: boolean; // default false per D-52
  // When false (default), test/fixture/mock paths are excluded from scanning.
  // Production routes almost never live under these paths; their handlers are
  // typically deliberately-broken fixtures that would otherwise dominate the
  // findings list. Set to true (via --include-tests / `scan_tests: true`) to
  // also audit test code.
  readonly scanTests?: boolean;
}

export interface WalkResult {
  // absolute paths, sorted, lstat-confirmed regular files within size cap + extension allowlist
  readonly files: ReadonlyArray<string>;
  // total skips (symlinks + oversize + non-allowlist)
  readonly skipped_count: number;
  // every regular file the walker considered (ScanMetadata.total_files_count)
  readonly total_files_count: number;
  // == files.length; engine final count = parsed_files - parse_errors
  readonly parsed_files_count_estimate: number;
  readonly oversized_count: number;
  readonly symlink_count: number;
  // files excluded by DEFAULT_TEST_GLOBS when scanTests is false; surfaced so
  // renderers can show "(N test files auto-excluded; use --include-tests)".
  readonly test_excluded_count: number;
}

interface IgnoreContext {
  readonly ig: Ignore;
}

async function readIgnoreFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function buildRootIgnore(rootPath: string): Promise<IgnoreContext> {
  const ig = ignore();
  const giContent = await readIgnoreFile(path.join(rootPath, ".gitignore"));
  if (giContent !== null) ig.add(giContent);
  const gxContent = await readIgnoreFile(path.join(rootPath, ".git", "info", "exclude"));
  if (gxContent !== null) ig.add(gxContent);
  // Always-on hard skips (D-50). Hard-skip is name-based; encode as ignore patterns too so the
  // gitignore check is the single source of truth for path filtering downstream.
  for (const d of HARD_SKIP_DIRS) ig.add(d);
  return { ig };
}

export async function walkProject(options: WalkOptions): Promise<WalkResult> {
  const root = path.resolve(options.rootPath);
  const concurrency = options.concurrency ?? Math.min(8, os.availableParallelism?.() ?? 4);
  const maxFileSize = options.maxFileSize ?? 1_048_576;
  const followSymlinks = options.followSymlinks ?? false;
  const scanTests = options.scanTests ?? false;

  const ctx = await buildRootIgnore(root);
  const limit = pLimit(concurrency);

  // tinyglobby honors gitignore-style ignore patterns via the `ignore` option. We layer:
  //  1. hard-skip globs (always)
  //  2. default test globs (unless scanTests=true) — keep these as a separate filter
  //     pass so we can count what was excluded for the renderer hint
  //  3. .gitignore content (root only — nested .gitignore is honored by reading per-dir below)
  // For Phase 3 we accept root-only .gitignore reading; nested .gitignore handling can be
  // addressed in a Phase 6 follow-up if the OSS corpus exposes the gap. Hard-skip already
  // covers the most common deep-nesting case (node_modules at any depth).
  const candidates = await glob(["**/*"], {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    dot: true,
    ignore: [...HARD_SKIP_GLOBS],
    followSymbolicLinks: followSymlinks,
  });

  // Apply test-path filter (counted) + .gitignore filter (silent).
  // T-03-23: reject any candidate that resolves outside the root.
  // Build a separate `ignore` instance for the test-path filter so the existing
  // root .gitignore semantics are preserved.
  const testIgnore = ignore().add([...DEFAULT_TEST_GLOBS]);
  let testExcludedCount = 0;
  const filtered = candidates.filter((abs) => {
    const rel = path.relative(root, abs);
    if (rel === "" || rel.startsWith("..")) return false;
    if (!scanTests && testIgnore.ignores(rel)) {
      testExcludedCount++;
      return false;
    }
    return !ctx.ig.ignores(rel);
  });

  let symlinkCount = 0;
  let oversizedCount = 0;
  let nonAllowlistCount = 0;
  const accepted: string[] = [];
  let totalConsidered = 0;

  await Promise.all(
    filtered.map((abs) =>
      limit(async () => {
        try {
          const st = await fs.lstat(abs);
          if (!st.isFile() && !st.isSymbolicLink()) return;
          totalConsidered++;
          if (st.isSymbolicLink() && !followSymlinks) {
            symlinkCount++;
            return;
          }
          if (st.size > maxFileSize) {
            oversizedCount++;
            return;
          }
          if (!isAllowlistedFile(abs)) {
            nonAllowlistCount++;
            return;
          }
          accepted.push(abs);
        } catch {
          // unreadable file; treat as skipped
        }
      }),
    ),
  );

  // T-03-24: sort for determinism so snapshot tests in Plan 08 are stable.
  accepted.sort();

  const skippedCount = symlinkCount + oversizedCount + nonAllowlistCount;
  return {
    files: accepted,
    skipped_count: skippedCount,
    total_files_count: totalConsidered,
    parsed_files_count_estimate: accepted.length,
    oversized_count: oversizedCount,
    symlink_count: symlinkCount,
    test_excluded_count: testExcludedCount,
  };
}
