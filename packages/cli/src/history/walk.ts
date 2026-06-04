// Phase 28 LEAK-05 — git-history walk orchestrator.
//
// `hookwarden scan --history [--since <ref|date>]` dispatches here. The orchestrator:
//   1. resolves a bounded commit range (resolveHistoryRange),
//   2. enumerates every unique blob in range INCLUDING deleted ones (gitHistoryBlobs),
//   3. feeds the deduped blob text through the EXISTING engine via the pipeline's virtualFiles
//      seam (no engine change — detection reuses secret_literal_match),
//   4. attaches provenance (commit short-SHA + historical path) to each finding, since the file
//      is gone from the worktree.
//
// Fully OSS and UNGATED (D-09) — --history is never entitlement-gated.

import type { ResolvedConfig } from "../config/precedence.js";
import { gitCommitForBlob, gitHistoryBlobs, resolveHistoryRange } from "../diff/git.js";
import { type RunScanOutput, runScan } from "../pipeline.js";

export interface HistoryScanInput {
  readonly rootPath: string;
  readonly resolvedConfig: ResolvedConfig;
  // null → default bound (last `defaultN` commits); otherwise a git ref or date.
  readonly since: string | null;
  readonly defaultN: number;
  readonly verbose: boolean;
  readonly providerFilter?: ReadonlySet<string> | null;
  readonly severityClassGroup?: string | null;
  readonly excludeGlobs?: ReadonlyArray<string>;
  readonly includeGlobs?: ReadonlyArray<string>;
}

export async function runHistoryScan(input: HistoryScanInput): Promise<RunScanOutput> {
  const cwd = input.rootPath;
  const rangeArgs = resolveHistoryRange(input.since, input.defaultN, cwd);
  const blobs = gitHistoryBlobs(rangeArgs, cwd);

  const virtualFiles = blobs.map((b) => ({ path: b.path, text: b.text }));
  // path → representative blob SHA, for resolving provenance on findings. A path reused across
  // commits with different content keeps the first-seen blob; provenance shows one representative
  // commit, which satisfies the "commit short-SHA + historical path" contract.
  const pathToBlob = new Map<string, string>();
  for (const b of blobs) {
    if (!pathToBlob.has(b.path)) pathToBlob.set(b.path, b.blobSha);
  }

  const output = await runScan({
    rootPath: cwd,
    resolvedConfig: input.resolvedConfig,
    diffOnly: false,
    diffBase: null,
    baselineWrite: false,
    verbose: input.verbose,
    providerFilter: input.providerFilter ?? null,
    severityClassGroup: input.severityClassGroup ?? null,
    excludeGlobs: input.excludeGlobs ?? [],
    includeGlobs: input.includeGlobs ?? [],
    virtualFiles,
  });

  // Resolve the introducing commit only for blobs that actually produced a finding (few), cached
  // by blob SHA so repeated findings in the same blob cost one `git log`.
  const commitCache = new Map<string, string | null>();
  const findings = output.result.findings.map((f) => {
    const blobSha = pathToBlob.get(f.file_path) ?? null;
    let commit: string | null = null;
    if (blobSha !== null) {
      if (!commitCache.has(blobSha)) commitCache.set(blobSha, gitCommitForBlob(blobSha, cwd));
      commit = commitCache.get(blobSha) ?? null;
    }
    const provenanceNote =
      commit !== null
        ? `In git history — commit ${commit}, path ${f.file_path} (since deleted).`
        : `In git history — path ${f.file_path} (since deleted).`;
    return {
      ...f,
      // Prepend a user-readable provenance line to the message (text renderer surfaces it) and
      // carry machine-readable provenance in metadata (JSON/SARIF). `metadata` is open, so this is
      // additive — no engine type change.
      message: `${provenanceNote}\n\n${f.message}`,
      metadata: {
        ...f.metadata,
        history_commit: commit,
        history_path: f.file_path,
      },
    };
  });

  return { ...output, result: { ...output.result, findings } };
}
