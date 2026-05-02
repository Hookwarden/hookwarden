// hookwarden audit engine — pure-functional, browser-safe.
// Decision D-01: no Node built-ins, no network libs.
// Decision D-02: evaluate() is async (uses globalThis.crypto.subtle).
// Decision D-03: RuleSet is pre-parsed by the caller; engine never reads files.
// Plan 02-08 wires the real evaluate() implementation against these contracts.

// Public type surface (Plan 02-01 D-25..D-39).
export type {
  Config,
  DeclarativeMatcher,
  Finding,
  FindingId,
  Framework,
  ImportEdge,
  MatcherName,
  MiddlewareRegistration,
  ParsedFile,
  ParseErrorRecord,
  ProjectModel,
  ProviderCatalog,
  ProviderCatalogEntry,
  ReachableSymbol,
  ResolvedMiddleware,
  RuleDefinition,
  RulePredicate,
  RuleSet,
  ScanMetadata,
  ScanResult,
  Severity,
  SourceLocation,
  Verdict,
  WebhookEvidence,
  WebhookEvidenceKind,
  WebhookHandler,
} from "./types/index.js";

import type { Config, ProjectModel, RuleSet, ScanResult } from "./types/index.js";

// Plan 02-08 ships the real evaluate() body. Until then this is a typed placeholder
// that satisfies the public contract so downstream packages (rules, cli) can compile.
export async function evaluate(
  _model: ProjectModel,
  _rules: RuleSet,
  _config: Config,
): Promise<ScanResult> {
  throw new Error("evaluate() is not yet implemented (Plan 02-08 wires the runtime).");
}
