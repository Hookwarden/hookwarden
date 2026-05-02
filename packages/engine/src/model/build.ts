// buildProjectModel: orchestrates parsers' output into a ProjectModel that the evaluator (Plan 08)
// consumes. Async (D-02 — handler ids are WebCrypto sha256). Pure (D-01 — no fs/http).
//
// Wires together:
//   - Plan 06a's detectCatalogHandlers + computeEvidence (6 of 7 D-32 signals)
//   - Plan 07's bespoke adapters (Next.js / Django / FastAPI) via the bespokeAdapters hook
//   - This plan's computeReachableSymbols (D-34 cross-file traversal) + extractMiddlewareChain (D-36)
//   - The sdk_verify_call evidence overlay — completes D-32's 7th signal.

import { computeHandlerId } from "../findings/fingerprint.js";
import { extractBabelLiterals } from "../parsers/literals.js";
import { extractPythonLiterals } from "../parsers/python-literals.js";
import { redactSnippet } from "../redaction/structural.js";
import type { Config } from "../types/config.js";
import type {
  Framework,
  ResolvedMiddleware,
  WebhookEvidence,
  WebhookHandler,
} from "../types/handler.js";
import type {
  ImportEdge,
  MiddlewareRegistration,
  ParsedFile,
  ProjectModel,
} from "../types/project-model.js";
import type { RuleSet } from "../types/rule-set.js";
import { detectCatalogHandlers, type CandidateHandler } from "./catalog.js";
import { computeEvidence } from "./evidence.js";
import { extractMiddlewareChain } from "./middleware.js";
import { computeReachableSymbols } from "./reachability.js";

export interface BuildProjectModelInput {
  readonly parsedFiles: ReadonlyArray<ParsedFile>;
  readonly ruleSet: RuleSet;
  readonly config: Config;
  // Plan 07 adapters (Next.js / Django / FastAPI) plug in here. Each returns CandidateHandler[].
  readonly bespokeAdapters?: ReadonlyArray<
    (file: ParsedFile, allFiles: ReadonlyArray<ParsedFile>) => ReadonlyArray<CandidateHandler>
  >;
}

export async function buildProjectModel(input: BuildProjectModelInput): Promise<ProjectModel> {
  // 1. Aggregate every file's imports → import_graph (engine-internal cross-file index).
  const import_graph: ImportEdge[] = [];
  for (const file of input.parsedFiles) {
    for (const edge of file.imports) import_graph.push(edge);
  }

  // 2. Detect candidate handlers per file (catalog + bespoke). Skip parse-error files (D-27).
  const candidates: Array<{ readonly cand: CandidateHandler; readonly file: ParsedFile }> = [];
  const adapters = input.bespokeAdapters ?? [];
  for (const file of input.parsedFiles) {
    if (file.parse_error !== null) continue;
    for (const cand of detectCatalogHandlers(file)) candidates.push({ cand, file });
    for (const adapter of adapters) {
      for (const cand of adapter(file, input.parsedFiles)) candidates.push({ cand, file });
    }
  }

  // 3. For each candidate, compute id + evidence (with sdk_verify_call overlay) + reachability +
  //    middleware_chain + redacted snippet.
  const handlers: WebhookHandler[] = [];
  for (const { cand, file } of candidates) {
    handlers.push(await assembleHandler(cand, file, input));
  }

  // 4. Aggregate middleware registrations at the project level (engine-internal index — Phase 8
  //    rule authors who need cross-handler middleware ordering can query this).
  const middleware_registrations: ReadonlyArray<MiddlewareRegistration> = [];

  return {
    parsed_files: input.parsedFiles,
    handlers,
    middleware_registrations,
    import_graph,
  };
}

async function assembleHandler(
  cand: CandidateHandler,
  file: ParsedFile,
  input: BuildProjectModelInput,
): Promise<WebhookHandler> {
  const id = await computeHandlerId({
    file_path: cand.file_path,
    route_pattern: cand.route_pattern,
    http_methods: cand.http_methods,
    handler_function_name: cand.handler_function_name,
  });
  const baseEvidence = computeEvidence({
    handler: cand,
    parsedFile: file,
    providerCatalog: input.ruleSet.providers,
    imports: file.imports,
  });
  const reachable_symbols = computeReachableSymbols({
    handler_body_node: cand.handler_body_node,
    handler_file: file,
    all_files: input.parsedFiles,
    imports: file.imports,
    maxDepth: input.config.reachability_max_depth,
  });
  const middleware_chain: ReadonlyArray<ResolvedMiddleware> = extractMiddlewareChain({
    handler: cand,
    parsedFile: file,
    imports: file.imports,
  });
  // sdk_verify_call evidence overlay (issue #7 fix) — completes D-32's 7th signal.
  const sdkVerifyEvidence = collectSdkVerifyCallEvidence(cand, reachable_symbols, input.ruleSet);
  const evidence: ReadonlyArray<WebhookEvidence> = [...baseEvidence.evidence, ...sdkVerifyEvidence];
  // Recompute provider attribution since sdk_verify_call evidence may shift the count.
  const provider = recomputeProvider(evidence, baseEvidence.provider);
  const redacted_snippet = renderHandlerSnippet(file, cand);
  return {
    id,
    framework: cand.framework as Framework,
    framework_version: cand.framework_version,
    route_pattern: cand.route_pattern,
    http_methods: cand.http_methods,
    file_path: cand.file_path,
    location: cand.location,
    handler_function_name: cand.handler_function_name,
    provider,
    verification_state: "manual-review", // PITFALLS #3 default; Plan 08 evaluator promotes
    evidence,
    middleware_chain,
    reachable_symbols,
    findings_ref: [], // back-populated by Plan 08 evaluator
    redacted_snippet,
  };
}

function collectSdkVerifyCallEvidence(
  cand: CandidateHandler,
  reachable_symbols: ReadonlyArray<{
    readonly qualified_name: string;
    readonly import_source: string | null;
  }>,
  ruleSet: RuleSet,
): ReadonlyArray<WebhookEvidence> {
  const out: WebhookEvidence[] = [];
  for (const [providerName, entry] of Object.entries(ruleSet.providers)) {
    for (const verifyCall of entry.sdk_verify_calls) {
      const matched = reachable_symbols.some(
        (s) =>
          s.qualified_name === verifyCall || s.qualified_name.endsWith(`.${verifyCall}`),
      );
      if (matched) {
        out.push({
          kind: "sdk_verify_call",
          provider: providerName,
          location: cand.location,
          detail: verifyCall,
        });
      }
    }
  }
  return out;
}

function recomputeProvider(
  evidence: ReadonlyArray<WebhookEvidence>,
  fallback: string,
): string {
  const counts = new Map<string, number>();
  for (const e of evidence) {
    if (e.provider === "unknown") continue;
    counts.set(e.provider, (counts.get(e.provider) ?? 0) + 1);
  }
  let topProvider = "unknown";
  let topCount = 0;
  let tied = false;
  for (const [p, c] of counts) {
    if (c > topCount) {
      topProvider = p;
      topCount = c;
      tied = false;
    } else if (c === topCount && c > 0) {
      tied = true;
    }
  }
  if (topProvider === "unknown") return fallback;
  return tied ? "multiple" : topProvider;
}

function renderHandlerSnippet(file: ParsedFile, cand: CandidateHandler): string {
  const slice = file.source_text.slice(cand.handler_source_start, cand.handler_source_end);
  const offset = cand.handler_source_start;
  const allLiterals =
    file.dialect === "babel"
      ? extractBabelLiterals(file.raw_ast as Parameters<typeof extractBabelLiterals>[0])
      : extractPythonLiterals(file.raw_ast as Parameters<typeof extractPythonLiterals>[0]);
  const sliceLiterals = allLiterals
    .filter(
      (l) =>
        l.start >= cand.handler_source_start && l.end <= cand.handler_source_end,
    )
    .map((l) => ({ ...l, start: l.start - offset, end: l.end - offset }));
  return redactSnippet({ source_text: slice, literals: sliceLiterals });
}
