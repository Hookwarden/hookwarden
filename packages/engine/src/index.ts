// hookwarden audit engine — pure-functional, browser-safe.
// Decision D-01: no Node built-ins, no network libs.
// Decision D-02: evaluate() is async (uses globalThis.crypto.subtle).
// Decision D-03: RuleSet is pre-parsed by the caller; engine never reads files.
// Decision D-23: engine source lives only in the public OSS repo.

// Public function surface.
export { ALL_ADAPTERS, type FrameworkAdapter } from "./adapters/index.js";
export { evaluate } from "./evaluate.js";
export { type BuildProjectModelInput, buildProjectModel } from "./model/index.js";
export { type ParseJsTsInput, parseJsTs } from "./parsers/babel.js";
export { type ParsePythonInput, parsePython } from "./parsers/python.js";
export {
  type InitPythonRuntimeInput,
  initPythonRuntime,
  type PythonRuntime,
} from "./parsers/python-loader.js";
// Public type surface (Plan 02-01 contract).
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
  SuppressedPayload,
  SuppressionSource,
  Verdict,
  WebhookEvidence,
  WebhookEvidenceKind,
  WebhookHandler,
} from "./types/index.js";
export { ENGINE_VERSION } from "./version.js";
