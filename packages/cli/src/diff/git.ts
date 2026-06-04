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

// ── Phase 28 LEAK-05: deleted-inclusive git-history blob walk ──────────────────
// The gitDiffNames* helpers above use --diff-filter=ACMR, which EXCLUDES D (deleted) —
// that exclusion is precisely the worktree-only gap this section closes. NEVER reuse the
// ACMR filter in the history path; a secret committed-then-deleted must still be enumerated.

// `runGit` writes nothing to stdin. cat-file --batch* needs the SHA list on stdin and (for
// content) returns raw bytes, so the history walk uses these two stdin-aware variants. Both keep
// the same injection-safe posture: array args via execFileSync, no shell. The large maxBuffer
// covers a full batch of blob contents in one read (bounded upstream by the size cap + dedup).
const HISTORY_MAX_BUFFER = 512 * 1024 * 1024;

function runGitTextStdin(args: ReadonlyArray<string>, cwd: string, input: string): string {
  return execFileSync("git", args as string[], {
    cwd,
    input,
    encoding: "utf8",
    maxBuffer: HISTORY_MAX_BUFFER,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function runGitBytesStdin(args: ReadonlyArray<string>, cwd: string, input: string): Buffer {
  return execFileSync("git", args as string[], {
    cwd,
    input,
    maxBuffer: HISTORY_MAX_BUFFER,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// Extension allowlist — only blobs the engine can parse are streamed; everything else (images,
// archives, lockfiles, etc.) is skipped at enumeration time so a binary never reaches a text
// parser (T-28-01-03). Mirrors the languages the pipeline parsers handle.
const SCANNABLE_HISTORY_EXTS: ReadonlySet<string> = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".py",
  ".pyi",
  ".php",
  ".go",
]);

// Per-blob size cap — a single huge blob fed to a parser is a DoS vector (T-28-01-03).
const MAX_HISTORY_BLOB_BYTES = 1_000_000;

export interface HistoryBlob {
  readonly blobSha: string;
  readonly path: string;
  readonly text: string;
}

function historyExtOf(p: string): string | null {
  const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  const base = slash >= 0 ? p.slice(slash + 1) : p;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = base.slice(dot).toLowerCase();
  return SCANNABLE_HISTORY_EXTS.has(ext) ? ext : null;
}

function gitRevParseVerify(ref: string, cwd: string): boolean {
  try {
    // `--quiet` makes rev-parse exit non-zero (→ throw) on an unresolvable ref.
    // `^{commit}` forces commit-ish resolution so a stray blob/tree SHA is not mistaken for a ref.
    runGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd);
    return true;
  } catch {
    return false;
  }
}

function gitRevListCount(cwd: string): number {
  const out = runGit(["rev-list", "--count", "HEAD"], cwd).trim();
  const n = Number.parseInt(out, 10);
  return Number.isFinite(n) ? n : 0;
}

// Resolve a bounded set of `rev-list` args from the optional --since value. The result is an
// argv fragment (NOT a shell string) appended verbatim to `["rev-list", ...]`, so every
// ref/date value flows as an array arg — never string-interpolated (T-28-01-01 / V5).
//
//   since === null         → default bound: last `defaultN` commits from HEAD, clamped to root.
//   since is a git ref     → "<ref>..HEAD".
//   since is anything else  → treated as a date bound: ["--since=<date>", "HEAD"].
export function resolveHistoryRange(since: string | null, defaultN: number, cwd: string): string[] {
  if (since !== null) {
    const trimmed = since.trim();
    if (trimmed.length === 0) {
      throw new Error("--since requires a non-empty git ref or date");
    }
    if (gitRevParseVerify(trimmed, cwd)) {
      return [`${trimmed}..HEAD`];
    }
    return [`--since=${trimmed}`, "HEAD"];
  }
  const count = gitRevListCount(cwd);
  if (count > defaultN) {
    return [`HEAD~${defaultN}..HEAD`];
  }
  // Shallow / small history — walk every reachable commit to root (no HEAD~N underflow).
  return ["HEAD"];
}

// Enumerate every unique blob (INCLUDING blobs for files deleted before HEAD) over the resolved
// range, dedup by content-addressed SHA (D-03 — identical content across commits is scanned once),
// classify type + size via a single batch-check, and stream contents via a single batch read
// (Pitfall 5 — never `cat-file -p` per blob in a loop). Returns deduped {blobSha, path, text}.
export function gitHistoryBlobs(rangeArgs: ReadonlyArray<string>, cwd: string): HistoryBlob[] {
  // Step 1 — list all objects reachable in the range with their paths. `--objects` prints a bare
  // commit SHA (no path) per commit, then "<sha> <path>" for every tree + blob. NO --diff-filter.
  const raw = runGit(["rev-list", ...rangeArgs, "--objects"], cwd);
  const byBlob = new Map<string, string>(); // candidate sha → representative path
  for (const line of raw.split("\n")) {
    const sp = line.indexOf(" ");
    if (sp < 0) continue; // commit SHA (no path) — skip
    const sha = line.slice(0, sp);
    const pth = line.slice(sp + 1);
    if (sha.length === 0 || pth.length === 0) continue;
    if (historyExtOf(pth) === null) continue; // extension allowlist (drops trees + binaries by ext)
    if (!byBlob.has(sha)) byBlob.set(sha, pth);
  }
  if (byBlob.size === 0) return [];

  // Step 2 — one batch-check classifies type + size for the whole candidate set. Trees that
  // slipped the ext filter are dropped here (type !== "blob"); oversized blobs are dropped too.
  const candidateShas = [...byBlob.keys()];
  const checkOut = runGitTextStdin(
    ["cat-file", "--batch-check", "--buffer"],
    cwd,
    `${candidateShas.join("\n")}\n`,
  );
  const blobShas: string[] = [];
  for (const line of checkOut.split("\n")) {
    if (line.trim().length === 0) continue;
    const parts = line.split(" ");
    const sha = parts[0];
    if (sha === undefined || parts[1] !== "blob") continue; // "<sha> missing" or non-blob
    const size = Number.parseInt(parts[2] ?? "", 10);
    if (!Number.isFinite(size) || size > MAX_HISTORY_BLOB_BYTES) continue;
    blobShas.push(sha);
  }
  if (blobShas.length === 0) return [];

  // Step 3 — one batch read streams every blob's content. Parsed by declared byte size so binary
  // content is handled exactly (no utf8 round-trip on the framing).
  const batch = runGitBytesStdin(
    ["cat-file", "--batch", "--buffer"],
    cwd,
    `${blobShas.join("\n")}\n`,
  );
  return parseHistoryBatch(batch, byBlob);
}

function parseHistoryBatch(buf: Buffer, byBlob: ReadonlyMap<string, string>): HistoryBlob[] {
  const out: HistoryBlob[] = [];
  let i = 0;
  while (i < buf.length) {
    const nl = buf.indexOf(0x0a, i);
    if (nl < 0) break;
    const header = buf.toString("utf8", i, nl); // "<sha> blob <size>" | "<sha> missing"
    i = nl + 1;
    const parts = header.split(" ");
    const sha = parts[0];
    if (sha === undefined || parts[1] !== "blob") {
      continue; // "missing" lines carry no content body
    }
    const size = Number.parseInt(parts[2] ?? "", 10);
    if (!Number.isFinite(size)) break;
    const content = buf.subarray(i, i + size);
    i += size;
    if (i < buf.length && buf[i] === 0x0a) i += 1; // trailing newline after each record
    if (content.includes(0x00)) continue; // NUL-byte guard — binary even on an allowlisted ext
    const path = byBlob.get(sha);
    if (path === undefined) continue;
    out.push({ blobSha: sha, path, text: content.toString("utf8") });
  }
  return out;
}

// Provenance helper — the short SHA of a commit that introduced/removed a given blob. Called only
// for blobs that actually produced a finding (typically very few), so the per-finding `git log`
// cost is negligible. Returns null when the commit cannot be resolved.
export function gitCommitForBlob(blobSha: string, cwd: string): string | null {
  try {
    const out = runGit(
      ["log", "-1", "--format=%h", `--find-object=${blobSha}`, "--all"],
      cwd,
    ).trim();
    if (out.length === 0) return null;
    return out.split("\n")[0] ?? null;
  } catch {
    return null;
  }
}
