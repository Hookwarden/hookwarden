// hookwarden audit engine — pure-functional, browser-safe.
// Decision D-01: no Node built-ins, no network libs.
// Decision D-02: evaluate() is async (uses globalThis.crypto.subtle).
// Decision D-03: RuleSet is pre-parsed by the caller; engine never reads files.
// Decision D-23: engine source lives only in the public OSS repo.

// Public function surface.
export { ALL_ADAPTERS, type FrameworkAdapter } from "./adapters/index.js";
// n8n workflow-JSON ingestion (Phase 24, AGENT-01) — first non-AST input path.
export { n8nAdapter } from "./adapters/n8n.js";
export { evaluate } from "./evaluate.js";
export {
  type BuildProjectModelInput,
  buildProjectModel,
  type N8nWorkflowFileInput,
} from "./model/index.js";
export { type ParseJsTsInput, parseJsTs } from "./parsers/babel.js";
export { type ParseGoInput, parseGo } from "./parsers/go.js";
export { extractGoLiterals } from "./parsers/go-literals.js";
export { type GoRuntime, type InitGoRuntimeInput, initGoRuntime } from "./parsers/go-loader.js";
export {
  isN8nWorkflow,
  locateNodeRange,
  parseN8nWorkflow,
} from "./parsers/n8n-workflow.js";
export { type ParsePhpInput, parsePhp } from "./parsers/php.js";
export { extractPhpLiterals } from "./parsers/php-literals.js";
export {
  type InitPhpRuntimeInput,
  initPhpRuntime,
  type PhpRuntime,
} from "./parsers/php-loader.js";
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
  FixMetadata,
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
// n8n synthetic-handler contract (Phase 24, AGENT-01).
export type {
  N8nNode,
  N8nParseError,
  N8nParseResult,
  N8nSyntheticHandler,
  N8nSyntheticHandlerAttrs,
  N8nWorkflowDocument,
} from "./types/n8n.js";
export { ENGINE_VERSION } from "./version.js";
