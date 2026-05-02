// D-01: Engine is pure — caller supplies wall clock and git context, engine never reads them.
// D-34: reachability_max_depth bounds handler reachability walk (default 3 hops).
// D-38: engine_commit_sha and total_files_count flow through Config into ScanMetadata.
// ENGINE-06: bounded reachability depth keeps the 30s/50KLOC perf budget achievable.

export interface Config {
  // ENGINE-06 — bounded reachability depth (D-34). Default 3 hops.
  readonly reachability_max_depth: number;
  // Engine is pure (D-01); the caller supplies the wall clock so the engine doesn't read it.
  readonly scanned_at: string; // ISO-8601 UTC
  // ScanMetadata.engine_commit_sha (D-38) — caller knows the git context, not the engine.
  readonly engine_commit_sha: string | null;
  // ScanMetadata.total_files_count is a caller responsibility (file walk happens outside the engine).
  readonly total_files_count: number;
}
