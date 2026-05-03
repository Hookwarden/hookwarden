// Public type surface for @hookwarden/engine. Anything not exported here is internal.
// Locked by phase-2 plan 01; later plans wire the runtime against these contracts.

export type { Config } from "./config.ts";
export type {
  Finding,
  FindingId,
  Severity,
  SourceLocation,
  SuppressedPayload,
  SuppressionSource,
  Verdict,
} from "./finding.ts";
export type {
  Framework,
  ReachableSymbol,
  ResolvedMiddleware,
  WebhookEvidence,
  WebhookEvidenceKind,
  WebhookHandler,
} from "./handler.ts";
export type {
  ImportEdge,
  MiddlewareRegistration,
  ParsedFile,
  ParseErrorRecord,
  ProjectModel,
} from "./project-model.ts";
export type {
  DeclarativeMatcher,
  MatcherName,
  PathSeverityOverride,
  ProviderCatalog,
  ProviderCatalogEntry,
  RuleDefinition,
  RulePredicate,
  RuleSet,
} from "./rule-set.ts";
export type { ScanMetadata, ScanResult } from "./scan-result.ts";
