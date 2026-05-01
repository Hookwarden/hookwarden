// hookwarden audit engine — pure-functional, browser-safe.
// Decision D-01: no Node built-ins, no network libs.
// Decision D-02: evaluate() is async (uses globalThis.crypto.subtle).
// Decision D-03: RuleSet is pre-parsed by the caller; engine never reads files.
// Phase 2 implements the real evaluate() function. This is a placeholder.

export type Finding = { ruleId: string; severity: "critical" | "high" | "medium" | "low" | "info" };
export type ProjectModel = Record<string, never>;
export type RuleSet = Record<string, never>;
export type Config = Record<string, never>;

export async function evaluate(
  _model: ProjectModel,
  _rules: RuleSet,
  _config: Config,
): Promise<Finding[]> {
  return [];
}
