// hookwarden CLI entry. Phase 3 implements the scan subcommand.

export async function main(_argv: string[]): Promise<number> {
  // Phase 3 implements the real scan flow (parse files, build ProjectModel, load RuleSet, evaluate).
  // Plan 02-09 updates this to call evaluate() with real inputs.
  return 0;
}
