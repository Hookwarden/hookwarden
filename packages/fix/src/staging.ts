// I/O module: explicit fs touch-point per Phase 8.2 D-20 / D-21.
//
// Atomic-write staging at `.hookwarden-fix-staging/<run-id>/` (D-20).
// Gitignore auto-add is loud-not-silent — stderr print line (D-21).

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

export interface StagedFile {
  readonly from: string; // absolute path of the original file
  readonly staged: string; // absolute path of the staged copy
  readonly rel: string; // repo-relative path
}

export interface StagingRun {
  readonly runId: string;
  readonly stagingDir: string;
  readonly repoRoot: string;
  readonly stagedFiles: StagedFile[];
}

const GITIGNORE_LINE = ".hookwarden-fix-staging/";
const GITIGNORE_REGEX = /^\s*\/?\.hookwarden-fix-staging\/?\s*$/m;
const STAGING_DIR_NAME = ".hookwarden-fix-staging";

export async function createStagingRun(repoRoot: string): Promise<StagingRun> {
  const runId = generateRunId();
  const stagingDir = path.join(repoRoot, STAGING_DIR_NAME, runId);
  await fs.mkdir(stagingDir, { recursive: true });
  return {
    runId,
    stagingDir,
    repoRoot,
    stagedFiles: [],
  };
}

export async function stageFile(
  run: StagingRun,
  repoRelPath: string,
  newContents: string,
): Promise<void> {
  if (typeof newContents !== "string") {
    throw new TypeError(`stageFile: newContents must be a string (got ${typeof newContents})`);
  }
  const staged = path.join(run.stagingDir, repoRelPath);
  await fs.mkdir(path.dirname(staged), { recursive: true });
  await fs.writeFile(staged, newContents, "utf-8");
  // Cast: stagedFiles is exposed as readonly to callers but mutated internally.
  (run.stagedFiles as StagedFile[]).push({
    from: path.join(run.repoRoot, repoRelPath),
    staged,
    rel: repoRelPath,
  });
}

/**
 * Per-file atomic rename via fs.rename. NOT atomic across the batch — if N renames
 * succeed and the (N+1)th fails, already-renamed files stay renamed. The orchestrator
 * (Plan 08 conflict-resolver) wraps commitStaging in a pre-commit re-scan gate so
 * the failure mode is caught BEFORE any rename, not midway.
 *
 * D-20 inspection contract: on ANY rename error, the staging dir PERSISTS for
 * the user to inspect. Only on full-batch success is the staging dir removed.
 */
export async function commitStaging(run: StagingRun): Promise<void> {
  for (const entry of run.stagedFiles) {
    await fs.rename(entry.staged, entry.from);
  }
  // All renames succeeded — clean up the staging dir.
  await fs.rm(run.stagingDir, { recursive: true, force: true });
}

export async function ensureGitignoreEntry(repoRoot: string): Promise<{ added: boolean }> {
  const gitignorePath = path.join(repoRoot, ".gitignore");
  let existing = "";
  try {
    existing = await fs.readFile(gitignorePath, "utf-8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw e;
  }
  if (GITIGNORE_REGEX.test(existing)) {
    return { added: false };
  }
  const needsLeadingNewline = existing.length > 0 && !existing.endsWith("\n");
  const appended = `${(needsLeadingNewline ? "\n" : "") + GITIGNORE_LINE}\n`;
  await fs.writeFile(gitignorePath, existing + appended, "utf-8");
  // D-21 loud-not-silent: write to stderr so the user sees the modification.
  // Cyan ANSI (matching the explain.ts finding-header color) when stderr is a TTY;
  // plain text otherwise.
  const useAnsi = process.stderr.isTTY === true;
  const open = useAnsi ? "\x1b[36m" : "";
  const close = useAnsi ? "\x1b[0m" : "";
  process.stderr.write(`${open}Added ${GITIGNORE_LINE} to .gitignore${close}\n`);
  return { added: true };
}

function generateRunId(): string {
  // ISO timestamp, with `:` replaced by `-` (Windows filesystem hostility), plus
  // 4 hex chars for collision-resistance within the same second.
  const iso = new Date().toISOString().replace(/:/g, "-").replace(/\.\d+/, "");
  const suffix = randomBytes(2).toString("hex");
  return `${iso}-${suffix}`;
}
