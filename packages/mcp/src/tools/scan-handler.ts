// scan_handler tool — Phase 23 Plan 23-05. Wires the pure @hookwarden/engine
// + bundled v0.7.0 rule pack into the MCP Tool.result shape per RESEARCH
// §Pitfall 5 (structuredContent first-class + companion stringified-JSON
// text block for backwards-compat).
//
// Owns:
//  - Call-time drift gate (D-23-12 second half — boot-time half in server.ts)
//  - 5 negative input shapes per D-23-08 (empty_input / exclusive_input_modes /
//    language_not_in_preview / unsupported_language / unknown_provider)
//  - Parse errors surface as findings (D-23-06 + ENGINE-07), NEVER as
//    transport-level crashes
//  - 3-state verdict vocabulary preserved verbatim per D-23-05
//  - Snippet redaction passed through verbatim (engine D-39 already structurally
//    redacted upstream)

import {
  ALL_ADAPTERS,
  buildProjectModel,
  type Config,
  evaluate,
  type GoRuntime,
  initGoRuntime,
  initPhpRuntime,
  initPythonRuntime,
  type ParsedFile,
  type PhpRuntime,
  type ProjectModel,
  type PythonRuntime,
  parseGo,
  parseJsTs,
  parsePhp,
  parsePython,
  type RuleSet,
  type ScanResult,
} from "@hookwarden/engine";
import {
  ALL_PREDICATES,
  BUNDLED_RULE_DOCUMENTS,
  loadRuleSet,
  PROVIDER_CATALOG,
  RULES_PACK_VERSION,
} from "@hookwarden/rules";

import { checkDrift } from "../drift-check.js";
import type { BuildManifest, ScanHandlerInput, ScanHandlerOutput } from "../types.js";
import { loadGoWasmBytes, loadPhpWasmBytes, loadPythonWasmBytes } from "../wasm/loader.js";

// ── Module-level lazy-init caches ────────────────────────────────────────
// The WASM load is ~100KB + parse + Parser.init — only pay it when at least
// one Python file shows up. Same for the rule set (parses 230 YAML rules).
let pythonRuntimePromise: Promise<PythonRuntime> | null = null;
function getPythonRuntime(): Promise<PythonRuntime> {
  if (pythonRuntimePromise === null) {
    pythonRuntimePromise = loadPythonWasmBytes().then((bytes) =>
      initPythonRuntime({ wasmBytes: bytes }),
    );
  }
  return pythonRuntimePromise;
}

let goRuntimePromise: Promise<GoRuntime> | null = null;
function getGoRuntime(): Promise<GoRuntime> {
  if (goRuntimePromise === null) {
    goRuntimePromise = loadGoWasmBytes().then((bytes) => initGoRuntime({ wasmBytes: bytes }));
  }
  return goRuntimePromise;
}

let phpRuntimePromise: Promise<PhpRuntime> | null = null;
function getPhpRuntime(): Promise<PhpRuntime> {
  if (phpRuntimePromise === null) {
    phpRuntimePromise = loadPhpWasmBytes().then((bytes) => initPhpRuntime({ wasmBytes: bytes }));
  }
  return phpRuntimePromise;
}

let ruleSetPromise: Promise<RuleSet> | null = null;
function getRuleSet(): Promise<RuleSet> {
  if (ruleSetPromise === null) {
    ruleSetPromise = loadRuleSet({
      rule_documents: BUNDLED_RULE_DOCUMENTS.map((e) => e.doc),
      predicates: ALL_PREDICATES,
      providers: PROVIDER_CATALOG,
      rule_pack_version: RULES_PACK_VERSION,
    });
  }
  return ruleSetPromise;
}

// Dispatch one file to the right parser, lazily loading that dialect's WASM
// runtime. Unknown/js/ts fall through to Babel (D-23-02 single-blob default).
async function parseSource(
  lang: LangKind,
  filePath: string,
  sourceText: string,
): Promise<ParsedFile> {
  const input = { file_path: filePath, source_text: sourceText };
  if (lang === "python") return parsePython(input, await getPythonRuntime());
  if (lang === "go") return parseGo(input, await getGoRuntime());
  if (lang === "php") return parsePhp(input, await getPhpRuntime());
  return parseJsTs(input);
}

// ── Provider catalog validation set (case-insensitive match) ─────────────
const VALID_PROVIDERS: ReadonlySet<string> = new Set(
  Object.keys(PROVIDER_CATALOG).map((id) => id.toLowerCase()),
);

// ── Supported languages — full CLI parity (js/ts/python/php/go) ──────────
const PREVIEW_LANGUAGES: ReadonlySet<string> = new Set(["js", "ts", "python", "php", "go"]);
const ALL_KNOWN_LANGUAGES: ReadonlySet<string> = new Set(["js", "ts", "python", "php", "go"]);

// ── File-extension → language mapping per D-23-02 ─────────────────────────
type LangKind = "js" | "ts" | "python" | "php" | "go" | "unknown";
function inferLanguage(filePath: string): LangKind {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "ts";
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  ) {
    return "js";
  }
  if (lower.endsWith(".py") || lower.endsWith(".pyi")) return "python";
  if (lower.endsWith(".php")) return "php";
  if (lower.endsWith(".go")) return "go";
  return "unknown";
}

// Single-blob extension synthesis when `code` + explicit `language` are given.
const EXT_BY_LANG: Readonly<Record<string, string>> = {
  js: ".js",
  ts: ".ts",
  python: ".py",
  php: ".php",
  go: ".go",
};

// ── Error helper ──────────────────────────────────────────────────────────
function errorResult(
  payload: Record<string, unknown> & { readonly error: string },
): ScanHandlerOutput {
  return {
    isError: true,
    content: [
      { type: "text", text: `hookwarden-mcp: ${payload.error}` },
      { type: "text", text: JSON.stringify(payload) },
    ],
    structuredContent: payload,
  };
}

// ── Main entry ────────────────────────────────────────────────────────────
export async function scanHandler(
  args: ScanHandlerInput,
  manifest: BuildManifest,
): Promise<ScanHandlerOutput> {
  try {
    // 1. Call-time drift gate (D-23-12, no env-var opt-out per D-23-13)
    const drift = await checkDrift(manifest);
    if (drift !== null) return errorResult({ ...drift });

    // 2. Input validation (D-23-01..D-23-09)
    const hasCode = typeof args.code === "string" && args.code.length > 0;
    const hasFiles =
      args.files !== undefined && args.files !== null && Object.keys(args.files).length > 0;

    if (!hasCode && !hasFiles) return errorResult({ error: "empty_input" });
    if (hasCode && hasFiles) return errorResult({ error: "exclusive_input_modes" });

    if (args.language !== undefined && !ALL_KNOWN_LANGUAGES.has(args.language)) {
      return errorResult({ error: "unsupported_language", got: args.language });
    }
    if (args.language !== undefined && !PREVIEW_LANGUAGES.has(args.language)) {
      // Defense in depth — every known language is also a supported language
      // now (full CLI parity). Kept so a future known-but-gated language lands
      // here rather than silently parsing as TS.
      return errorResult({ error: "language_not_in_preview", language: args.language });
    }

    let providerFilter: string | null = null;
    if (typeof args.provider === "string" && args.provider.trim() !== "") {
      const lower = args.provider.trim().toLowerCase();
      if (!VALID_PROVIDERS.has(lower)) {
        return errorResult({
          error: "unknown_provider",
          got: args.provider,
          known: [...VALID_PROVIDERS].sort(),
        });
      }
      providerFilter = lower;
    }

    // 3. Build the (path → source) input map
    const fileMap = new Map<string, string>();
    if (hasCode) {
      const ext = args.language ? (EXT_BY_LANG[args.language] ?? ".ts") : ".ts";
      fileMap.set(`__handler${ext}`, args.code as string);
    } else if (args.files) {
      for (const [path, src] of Object.entries(args.files)) {
        fileMap.set(path, src);
      }
    }

    // 4. Parse — collect ParsedFile[]. parseSource always returns a ParsedFile,
    //    with parse failures baked into ParsedFile.parse_errors; engine surfaces
    //    those as ENGINE-07 findings during evaluate(). WASM runtimes are
    //    lazy-initialised per dialect inside parseSource (only paid for if a
    //    file of that dialect is present; the get*Runtime caches memoize).
    const parsedFiles: ParsedFile[] = [];
    for (const [filePath, sourceText] of fileMap) {
      const lang = args.language ?? inferLanguage(filePath);
      parsedFiles.push(await parseSource(lang, filePath, sourceText));
    }

    // 5. Build model + evaluate
    const config: Config = {
      reachability_max_depth: 3,
      scanned_at: new Date().toISOString(),
      engine_commit_sha: null,
      total_files_count: parsedFiles.length,
    };

    let ruleSet = await getRuleSet();
    if (providerFilter !== null) {
      ruleSet = {
        ...ruleSet,
        rules: ruleSet.rules.filter((r) => r.provider.toLowerCase() === providerFilter),
      };
    }

    const model: ProjectModel = await buildProjectModel({
      parsedFiles,
      ruleSet,
      config,
      bespokeAdapters: ALL_ADAPTERS,
    });
    const result: ScanResult = await evaluate(model, ruleSet, config);

    // 6. Assemble structuredContent per D-23-04 (revised by Pitfall 5)
    const verdictSummary = {
      verified: 0,
      not_verified: 0,
      manual_review: 0,
      parse_error: 0,
    };
    for (const f of result.findings) {
      if (f.rule_id === "engine/parse-error" || f.rule_id === "parse-error") {
        verdictSummary.parse_error += 1;
      } else if (f.state === "verified") verdictSummary.verified += 1;
      else if (f.state === "not-verified") verdictSummary.not_verified += 1;
      else if (f.state === "manual-review") verdictSummary.manual_review += 1;
    }

    const findings = result.findings.map((f) => ({
      rule_id: f.rule_id,
      severity: f.severity,
      verdict: f.state, // PRESERVE 3-state verbatim per D-23-05
      provider: f.provider,
      file: f.file_path,
      line_start: f.location.line,
      line_end: f.location.end_line,
      message: f.message, // already redacted by engine per D-23-07
      // ProviderCatalogEntry has no docs URL field in v0.7.0; surface as null
      // and let docs page (Plan 23-07) link the canonical provider doc out-of-band.
      provider_docs_url: null,
      rule_pack_version: RULES_PACK_VERSION,
    }));

    const structuredContent = {
      verdict_summary: verdictSummary,
      findings,
      scan_metadata: {
        engine_version: manifest.engine.version,
        rule_pack_version: manifest.rules.version,
        rule_pack_content_hash: manifest.rules.content_hash,
      },
    };

    // 7. Human one-liner (D-23-04)
    const total = result.findings.length;
    const headline =
      total === 0
        ? "hookwarden scan_handler: 0 findings."
        : `hookwarden scan_handler: ${total} finding${total === 1 ? "" : "s"} (${verdictSummary.not_verified} not-verified, ${verdictSummary.manual_review} manual-review, ${verdictSummary.parse_error} parse-error).`;

    return {
      content: [
        { type: "text", text: headline },
        { type: "text", text: JSON.stringify(structuredContent) },
      ],
      structuredContent,
    };
  } catch (err) {
    // D-23-08: never throw past the tool boundary. Errors are CallToolResult
    // values with isError:true. Sanitize the message.
    const message = err instanceof Error ? err.message : String(err);
    return errorResult({ error: "internal_error", message });
  }
}
