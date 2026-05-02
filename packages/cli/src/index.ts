// hookwarden CLI entry. Phase 3 implements the scan subcommand and renderers.
// Phase 2 keeps this file compiling against the new public engine API (D-35 ScanResult).

import { type Config, evaluate, type RuleSet, type ScanResult } from "@hookwarden/engine";

export async function main(_argv: ReadonlyArray<string>): Promise<number> {
  // Placeholder: empty inputs, deterministic shape, no I/O. Phase 3 wires real file walk + renderers.
  const ruleSet: RuleSet = {
    schema_version: 1,
    rule_pack_version: "0.0.1",
    providers: {},
    rules: [],
    predicates: {},
  };
  const config: Config = {
    reachability_max_depth: 3,
    // CLI is allowed to read the wall clock; engine is not (D-01).
    scanned_at: new Date(0).toISOString(),
    engine_commit_sha: null,
    total_files_count: 0,
  };
  const result: ScanResult = await evaluate(
    { parsed_files: [], handlers: [], middleware_registrations: [], import_graph: [] },
    ruleSet,
    config,
  );
  // Smoke check that the ScanResult shape is intact. Phase 3 replaces with the real renderer.
  if (result.metadata.engine_version === "") return 2;
  return 0;
}
