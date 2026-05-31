// buildProjectModel: orchestrates parsers' output into a ProjectModel that the evaluator (Plan 08)
// consumes. Async (D-02 — handler ids are WebCrypto sha256). Pure (D-01 — no fs/http).
//
// Wires together:
//   - Plan 06a's detectCatalogHandlers + computeEvidence (6 of 7 D-32 signals)
//   - Plan 07's bespoke adapters (Next.js / Django / FastAPI) via the bespokeAdapters hook
//   - This plan's computeReachableSymbols (D-34 cross-file traversal) + extractMiddlewareChain (D-36)
//   - The sdk_verify_call evidence overlay — completes D-32's 7th signal.
//   - The raw-body middleware evidence overlay — prevents FP on express.raw / bodyParser.raw chains.

import { n8nAdapter } from "../adapters/n8n.js";
import { computeHandlerId } from "../findings/fingerprint.js";
import { isN8nWorkflow, parseN8nWorkflow } from "../parsers/n8n-workflow.js";
import type { N8nSyntheticHandler } from "../types/n8n.js";
import { extractBabelLiterals } from "../parsers/literals.js";
import { extractPythonLiterals } from "../parsers/python-literals.js";
import { walkBabelAst } from "../parsers/walk.js";
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
import { type CandidateHandler, detectCatalogHandlers } from "./catalog.js";
import { computeEvidence } from "./evidence.js";
import { collectVerifyOrderingEvidence } from "./handler-cfg.js";
import { extractMiddlewareChain } from "./middleware.js";
import { computeReachableSymbols } from "./reachability.js";

export interface N8nWorkflowFileInput {
  readonly file_path: string; // repo-relative
  readonly source_text: string; // raw *.workflow.json text — engine never reads files (D-03)
}

export interface BuildProjectModelInput {
  readonly parsedFiles: ReadonlyArray<ParsedFile>;
  readonly ruleSet: RuleSet;
  readonly config: Config;
  // Phase 24 (AGENT-01) — content-driven n8n detection inputs. Both optional; absent => identical
  // behavior to pre-n8n builds (the n8n path is purely additive; existing providers untouched).
  //
  // workflowFiles: raw *.workflow.json candidates surfaced by the CLI walker (the engine is pure —
  // it never reads files; the caller hands us the source text). Each is content-sniffed via
  // isN8nWorkflow; ONLY n8n-shaped documents route through n8nAdapter into synthetic handlers. A
  // random *.workflow.json that does NOT sniff as n8n yields zero handlers (FP moat — T-24-06;
  // glob presence alone never fires).
  readonly workflowFiles?: ReadonlyArray<N8nWorkflowFileInput>;
  // customNodeSignal: true when the project is an n8n community/custom-node project — set by the
  // caller from package.json#n8n.nodes. The engine ALSO derives a per-file TS signal from
  // INodeType / IWebhookFunctions imports (see fileHasN8nCustomNodeSignal). Either signal tags a
  // file's handlers provider:n8n so Plan 24-04's detector-2 rule applies to them.
  readonly customNodeSignal?: boolean;
  // Plan 07 adapters (Next.js / Django / FastAPI) plug in here. Each returns CandidateHandler[].
  readonly bespokeAdapters?: ReadonlyArray<
    (file: ParsedFile, allFiles: ReadonlyArray<ParsedFile>) => ReadonlyArray<CandidateHandler>
  >;
}

export async function buildProjectModel(input: BuildProjectModelInput): Promise<ProjectModel> {
  // 1. Aggregate every file's imports → import_graph (engine-internal cross-file index).
  const importGraph: ImportEdge[] = [];
  for (const file of input.parsedFiles) {
    for (const edge of file.imports) importGraph.push(edge);
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

  // 3a. Phase 24 (AGENT-01) — n8n custom-node TS tagging. A handler is re-attributed provider:n8n
  //     when EITHER the project-level custom-node signal is set (package.json#n8n.nodes, supplied
  //     by the caller) OR its own file content-sniffs as an n8n custom node (imports INodeType /
  //     IWebhookFunctions from n8n-workflow). This is a per-file content signal, never glob/path
  //     based — non-n8n TS files are never tagged. Tagging is additive: it only overrides provider,
  //     leaving every other handler field (evidence, verdict baseline, location) intact, so it
  //     cannot change findings on any non-n8n handler.
  const n8nSignalFiles = new Set<string>();
  if (input.customNodeSignal === true) {
    for (const f of input.parsedFiles) n8nSignalFiles.add(f.file_path);
  }
  for (const f of input.parsedFiles) {
    if (fileHasN8nCustomNodeSignal(f)) n8nSignalFiles.add(f.file_path);
  }
  if (n8nSignalFiles.size > 0) {
    for (let i = 0; i < handlers.length; i++) {
      const h = handlers[i];
      if (h !== undefined && n8nSignalFiles.has(h.file_path) && h.provider !== "n8n") {
        handlers[i] = { ...h, provider: "n8n" };
      }
    }
  }

  // 3b. Phase 24 (AGENT-01) — n8n workflow-JSON synthetic handlers. Each *.workflow.json candidate
  //     is content-sniffed (isN8nWorkflow); only n8n-shaped documents are walked by n8nAdapter and
  //     lifted into full WebhookHandlers. These bypass assembleHandler entirely — they have NO AST,
  //     so the babel/tree-sitter overlays in assembleHandler do not apply (RESEARCH: route the
  //     synthetic handler directly into ProjectModel.handlers). Glob presence alone never fires.
  for (const wf of input.workflowFiles ?? []) {
    const parsed = parseN8nWorkflow(wf.source_text, wf.file_path);
    if (!isN8nWorkflow(parsed.document)) continue;
    for (const descriptor of n8nAdapter(parsed)) {
      handlers.push(await assembleN8nHandler(descriptor));
    }
  }

  // 4. Aggregate middleware registrations at the project level (engine-internal index — Phase 8
  //    rule authors who need cross-handler middleware ordering can query this).
  const middlewareRegistrations: ReadonlyArray<MiddlewareRegistration> = [];

  return {
    parsed_files: input.parsedFiles,
    handlers,
    middleware_registrations: middlewareRegistrations,
    import_graph: importGraph,
  };
}

// Phase 24 (AGENT-01) — per-file n8n custom-node content sniff. True when the file imports any of
// the canonical n8n node interfaces from the `n8n-workflow` package (INodeType / IWebhookFunctions /
// INodeTypeDescription). The babel parser already records import edges with their imported names,
// so this is a pure read over ParsedFile.imports — no extra parse. Drift-tolerant: matches on the
// `n8n-workflow` module + any recognized interface name, never on a specific package version.
const N8N_NODE_INTERFACE_NAMES: ReadonlySet<string> = new Set([
  "INodeType",
  "IWebhookFunctions",
  "INodeTypeDescription",
]);

function fileHasN8nCustomNodeSignal(file: ParsedFile): boolean {
  if (file.parse_error !== null) return false;
  for (const edge of file.imports) {
    if (edge.to_module !== "n8n-workflow") continue;
    for (const named of edge.imported_names) {
      if (N8N_NODE_INTERFACE_NAMES.has(named.source)) return true;
    }
  }
  return false;
}

// Phase 24 (AGENT-01) — lift an n8n synthetic-handler descriptor into a full WebhookHandler WITHOUT
// running the AST overlays in assembleHandler (the n8n workflow node has no AST). The descriptor's
// node params become `n8n_node_param` evidence — the binding contract Plan 24-02's
// `n8n-trigger-no-auth` predicate reads (`detail = "authentication=<value>"`). verification_state
// stays at the manual-review baseline (PITFALLS #3); the evaluator promotes it when a rule fires.
async function assembleN8nHandler(
  descriptor: N8nSyntheticHandler,
): Promise<WebhookHandler> {
  const routePattern = descriptor.attrs.path !== null ? `/${descriptor.attrs.path}` : "/";
  const httpMethods = descriptor.attrs.httpMethod !== null ? [descriptor.attrs.httpMethod.toUpperCase()] : ["POST"];
  const handlerFunctionName = descriptor.nodeName;
  const id = await computeHandlerId({
    file_path: descriptor.file,
    route_pattern: routePattern,
    http_methods: httpMethods,
    handler_function_name: handlerFunctionName,
  });
  // One n8n_node_param evidence row per node param (Plan 24-02 contract: detail = "key=value").
  // authentication is FIRST and always present (the adapter normalized absent -> "none").
  const evidence: WebhookEvidence[] = [
    {
      kind: "n8n_node_param",
      provider: "n8n",
      location: descriptor.range,
      detail: `authentication=${descriptor.attrs.authentication}`,
    },
    {
      kind: "n8n_node_param",
      provider: "n8n",
      location: descriptor.range,
      detail: `nodeType=${descriptor.attrs.nodeType}`,
    },
  ];
  if (descriptor.attrs.httpMethod !== null) {
    evidence.push({
      kind: "n8n_node_param",
      provider: "n8n",
      location: descriptor.range,
      detail: `httpMethod=${descriptor.attrs.httpMethod}`,
    });
  }
  return {
    id,
    framework: "n8n-workflow",
    framework_version: null,
    route_pattern: routePattern,
    http_methods: httpMethods,
    file_path: descriptor.file,
    location: descriptor.range,
    handler_function_name: handlerFunctionName,
    provider: "n8n",
    verification_state: "manual-review", // PITFALLS #3 baseline; evaluator promotes
    evidence,
    middleware_chain: [], // no AST — no middleware concept for a JSON node
    reachable_symbols: [], // no AST — no reachability for a JSON node
    findings_ref: [], // back-populated by the evaluator
    redacted_snippet: "", // JSON node params are not free-text source; nothing to redact
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
  const reachableSymbols = computeReachableSymbols({
    handler_body_node: cand.handler_body_node,
    handler_file: file,
    all_files: input.parsedFiles,
    imports: file.imports,
    maxDepth: input.config.reachability_max_depth,
  });
  const middlewareChain: ReadonlyArray<ResolvedMiddleware> = extractMiddlewareChain({
    handler: cand,
    parsedFile: file,
    imports: file.imports,
  });
  // sdk_verify_call evidence overlay (issue #7 fix) — completes D-32's 7th signal.
  const sdkVerifyEvidence = collectSdkVerifyCallEvidence(cand, reachableSymbols, input.ruleSet);
  // raw-body middleware evidence overlay — prevents stripe/raw-body-misuse FP when express.raw
  // (or bodyParser.raw) is registered as an inline route middleware argument. The handler text
  // search in evidence.ts only sees the arrow function body, not outer route arguments.
  const rawBodyMwEvidence = collectRawBodyMiddlewareEvidence(cand, middlewareChain);
  // Inline-middleware verify overlay — prevents `not-verified` FP when verification is done in
  // an INLINE arrow-function route middleware (not in the final handler arg). The reachability
  // pass walks `handler_body_node` only, and matchRouteArgsMiddleware skips anonymous arrow
  // middleware (no name), so verify calls in inline arrows are invisible to the existing
  // signals. Walks the route registration's sibling arrow-function args for any
  // catalog `sdk_verify_calls` shape and emits matching `sdk_verify_call` evidence.
  const inlineMwVerifyEvidence = collectInlineMiddlewareVerifyEvidence(cand, file, input.ruleSet);
  // PHP sdk_verify_call overlay — the reachability pass only handles babel + tree-sitter-python,
  // so PHP scoped-call / member-call verify shapes never surface in reachable_symbols. Walk the
  // handler-bearing file's PHP tree for matching call shapes against catalog sdk_verify_calls.
  const phpVerifyEvidence = collectPhpSdkVerifyEvidence(cand, file, input.ruleSet);
  const preCfgEvidence: ReadonlyArray<WebhookEvidence> = [
    ...baseEvidence.evidence,
    ...sdkVerifyEvidence,
    ...rawBodyMwEvidence,
    ...inlineMwVerifyEvidence,
    ...phpVerifyEvidence,
  ];
  // Recompute provider attribution since sdk_verify_call evidence may shift the count.
  const provider = recomputeProvider(preCfgEvidence, baseEvidence.provider);
  // v0.7 Rule Depth handler-cfg overlay (VAS-01) — emits `side_effect_before_verify`
  // evidence for each T1/T2 side effect appearing BEFORE a verification call in
  // handler scope. JS/TS only at v0.7.0; PHP/Python emit empty evidence. The
  // overlay needs the resolved `provider` (above), so it must run AFTER the
  // recomputed provider attribution.
  const verifyOrderingEvidence = collectVerifyOrderingEvidence({
    handler_body_node: cand.handler_body_node,
    location: cand.location,
    providerCatalog: input.ruleSet.providers,
    provider,
    reachable_qnames: new Set(reachableSymbols.map((s) => s.qualified_name)),
  });
  const evidence: ReadonlyArray<WebhookEvidence> = [...preCfgEvidence, ...verifyOrderingEvidence];
  const redactedSnippet = renderHandlerSnippet(file, cand);
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
    middleware_chain: middlewareChain,
    reachable_symbols: reachableSymbols,
    findings_ref: [], // back-populated by Plan 08 evaluator
    redacted_snippet: redactedSnippet,
  };
}

function collectSdkVerifyCallEvidence(
  cand: CandidateHandler,
  reachableSymbols: ReadonlyArray<{
    readonly qualified_name: string;
    readonly import_source: string | null;
  }>,
  ruleSet: RuleSet,
): ReadonlyArray<WebhookEvidence> {
  const out: WebhookEvidence[] = [];
  for (const [providerName, entry] of Object.entries(ruleSet.providers)) {
    for (const verifyCall of entry.sdk_verify_calls) {
      const matched = reachableSymbols.some(
        (s) => s.qualified_name === verifyCall || s.qualified_name.endsWith(`.${verifyCall}`),
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

// Raw-body middleware names that guarantee the body arrives as a Buffer/bytes to the handler.
// Covers both `express.raw(...)` (qualified member call) and `raw(...)` (named import from express
// or body-parser). import_source guard prevents false-negatives from unrelated `raw` middleware.
const RAW_BODY_MIDDLEWARE_NAMES: ReadonlySet<string> = new Set([
  "express.raw",
  "raw", // named import: import { raw } from 'express'  or  import { raw } from 'body-parser'
]);

const RAW_BODY_IMPORT_SOURCES: ReadonlySet<string> = new Set(["express", "body-parser"]);

// PHP sdk_verify_call detection — substring-matches catalog `sdk_verify_calls` against the
// handler's source-text range. The match is intentionally textual (not AST-based): tree-sitter
// reachability doesn't traverse PHP, and PHP webhook handlers almost always include the verify
// call inline (`\Stripe\Webhook::constructEvent($payload, $sig, $secret)`). A future revision
// can layer cross-file reachability for PHP — out of scope for Phase 8.1 (D-34 v1 cap).
function collectPhpSdkVerifyEvidence(
  cand: CandidateHandler,
  file: ParsedFile,
  ruleSet: RuleSet,
): ReadonlyArray<WebhookEvidence> {
  if (file.dialect !== "tree-sitter-php") return [];
  if (file.raw_ast === null) return [];

  // Walk only the handler's text range to keep evidence scoped to the handler body. Two match
  // shapes: (a) static FQN appears in the body (e.g. `\Stripe\Webhook::constructEvent(...)`),
  // (b) method name appears as instance call (e.g. `$validator->validate(...)`) AND the catalog
  // entry's namespace was imported by the file. Shape (b) covers Twilio's instance-only API.
  const handlerText = file.source_text.slice(cand.handler_source_start, cand.handler_source_end);
  const imports = file.imports;
  const out: WebhookEvidence[] = [];
  const seen = new Set<string>();

  for (const [providerName, entry] of Object.entries(ruleSet.providers)) {
    for (const verifyCall of entry.sdk_verify_calls) {
      // Only consider PHP-shaped entries (contain `\` or `::`) for PHP overlay. JS-shaped
      // dotted entries fall through to the reachability path.
      const isPhpShape = verifyCall.includes("::") || verifyCall.includes("\\");
      if (!isPhpShape) continue;

      const key = `${providerName}|${verifyCall}`;
      if (seen.has(key)) continue;

      // Shape (a) — static FQN substring match. Tolerate a leading `\` prefix at the call site.
      const stripped = verifyCall.startsWith("\\") ? verifyCall.slice(1) : verifyCall;
      if (handlerText.includes(stripped)) {
        seen.add(key);
        out.push({
          kind: "sdk_verify_call",
          provider: providerName,
          location: cand.location,
          detail: verifyCall,
        });
        continue;
      }

      // Shape (b) — instance-call form. Extract namespace + method from the catalog entry
      // (`Twilio\Security\RequestValidator::validate` → ns `Twilio\Security\RequestValidator`,
      // method `validate`), then check: namespace prefix was imported AND `->method(` appears
      // in handler body. The namespace-import check anchors the match to the right provider.
      const sepIdx = stripped.indexOf("::");
      if (sepIdx === -1) continue;
      const nsClass = stripped.slice(0, sepIdx); // e.g. "Twilio\\Security\\RequestValidator"
      const methodName = stripped.slice(sepIdx + 2); // e.g. "validate"
      if (methodName === "") continue;
      const nsImported = imports.some(
        (i) => i.to_module === nsClass || i.to_module.startsWith(`${nsClass}\\`),
      );
      if (!nsImported) continue;
      if (handlerText.includes(`->${methodName}(`)) {
        seen.add(key);
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

function collectRawBodyMiddlewareEvidence(
  cand: CandidateHandler,
  middlewareChain: ReadonlyArray<ResolvedMiddleware>,
): ReadonlyArray<WebhookEvidence> {
  const hasRawMiddleware = middlewareChain.some(
    (m) =>
      RAW_BODY_MIDDLEWARE_NAMES.has(m.name) &&
      m.import_source !== null &&
      RAW_BODY_IMPORT_SOURCES.has(m.import_source),
  );
  if (!hasRawMiddleware) return [];
  return [
    {
      kind: "body_as_bytes_or_buffer",
      provider: "unknown",
      location: cand.location,
      detail: "raw-body middleware in chain",
    },
  ];
}

// Inline-middleware verify overlay — recognises catalog `sdk_verify_calls` when they appear
// inside an inline arrow-function (or function-expression) middleware passed as a route argument.
//
// Why this is needed: `matchRouteArgsMiddleware` in middleware.ts only adds args with a NAMED
// callee (Identifier / MemberExpression / CallExpression) to `middleware_chain`; inline
// ArrowFunctionExpression / FunctionExpression args are skipped (no name to attach). And
// `computeReachableSymbols` walks `cand.handler_body_node` only — the last route arg — so verify
// calls inside SIBLING arrow-function middlewares are invisible to every existing signal.
//
// The fix is purely additive: walk the route registration's CallExpression for arrow-function
// args (positions [1..len-2]; index 0 is the path, last is the handler), and for each, scan
// its body for any of the provider catalog's `sdk_verify_calls` qualified names. Emit a
// `sdk_verify_call` evidence row per match — same shape `collectSdkVerifyCallEvidence` emits
// from `reachable_symbols`. The evaluator's `library-verified` rule then promotes the verdict.
function collectInlineMiddlewareVerifyEvidence(
  cand: CandidateHandler,
  file: ParsedFile,
  ruleSet: RuleSet,
): ReadonlyArray<WebhookEvidence> {
  if (file.dialect !== "babel") return [];
  if (file.raw_ast === null) return [];

  // Walk the file looking for the CallExpression that registers this handler — match by the
  // ExpressionStatement's source location to `cand.location`. Mirrors the shape that
  // `matchRouteArgsMiddleware` keys on, so the two functions agree on which call is "ours".
  const ast = file.raw_ast as import("@babel/types").File;

  // Build a flat list of sdk_verify_calls (per-provider) so each match emits the right provider.
  type VerifyEntry = { readonly provider: string; readonly qualifiedName: string };
  const verifyEntries: VerifyEntry[] = [];
  for (const [providerName, entry] of Object.entries(ruleSet.providers)) {
    for (const v of entry.sdk_verify_calls) {
      // Skip PHP-shaped entries (`::` or `\`) — those are handled by collectPhpSdkVerifyEvidence.
      if (v.includes("::") || v.includes("\\")) continue;
      verifyEntries.push({ provider: providerName, qualifiedName: v });
    }
  }
  if (verifyEntries.length === 0) return [];

  const out: WebhookEvidence[] = [];
  const seen = new Set<string>();

  walkBabelAst(ast, (node) => {
    if (node.type !== "ExpressionStatement") return;
    const expr = node.expression;
    if (expr.type !== "CallExpression") return;
    const callee = expr.callee;
    // Route registration shape: `app.<method>(path, ...mw, handler)` — same gate as
    // matchRouteArgsMiddleware. Need at least 3 args (path + ≥1 mw + handler).
    if (callee.type !== "MemberExpression") return;
    if (callee.property.type !== "Identifier") return;
    if (expr.arguments.length < 3) return;

    // Match this call to our handler by source line/col (matchRouteArgsMiddleware's identity check).
    const loc = node.loc;
    if (loc === null || loc === undefined) return;
    if (loc.start.line !== cand.location.line) return;
    if ((loc.start.column ?? 0) + 1 !== cand.location.col) return;

    // Middleware args are positions [1..len-2]; the handler itself is the final arg.
    for (let i = 1; i < expr.arguments.length - 1; i++) {
      const arg = expr.arguments[i];
      if (!arg) continue;
      // Only inline functions need this overlay — named args go through middleware_chain +
      // the regular reachable_symbols pass on the (final) handler.
      if (arg.type !== "ArrowFunctionExpression" && arg.type !== "FunctionExpression") continue;

      // Walk the inline function body for sdk_verify_call shapes. Match either the bare
      // identifier (e.g. `constructEvent`) or the dotted qualified name (e.g.
      // `stripe.webhooks.constructEvent`). Mirrors the reachable_symbols match in
      // collectSdkVerifyCallEvidence (`s.qualified_name === verifyCall ||
      // s.qualified_name.endsWith('.' + verifyCall)`).
      walkBabelAst(arg.body, (inner) => {
        if (inner.type !== "CallExpression") return;
        const innerCallee = inner.callee;
        const calleeName = qualifiedNameOf(innerCallee);
        if (calleeName === null) return;
        for (const { provider, qualifiedName } of verifyEntries) {
          if (calleeName === qualifiedName || calleeName.endsWith(`.${qualifiedName}`)) {
            const key = `${provider}|${qualifiedName}|${i}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
              kind: "sdk_verify_call",
              provider,
              location: cand.location,
              detail: qualifiedName,
            });
          }
        }
      });
    }
  });

  return out;
}

// Helper — resolve an AST node to its dotted qualified name when it's an Identifier or
// MemberExpression chain. Returns null for anything else (e.g. computed members, call results).
// Mirrors `identifierOrMemberName` in middleware.ts but kept local to avoid a cross-module
// import cycle; the two implementations are intentionally identical in shape.
function qualifiedNameOf(node: import("@babel/types").Node): string | null {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") {
    const obj = qualifiedNameOf(node.object);
    if (obj && node.property.type === "Identifier") return `${obj}.${node.property.name}`;
    return null;
  }
  return null;
}

function recomputeProvider(evidence: ReadonlyArray<WebhookEvidence>, fallback: string): string {
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
    .filter((l) => l.start >= cand.handler_source_start && l.end <= cand.handler_source_end)
    .map((l) => ({ ...l, start: l.start - offset, end: l.end - offset }));
  return redactSnippet({ source_text: slice, literals: sliceLiterals });
}
