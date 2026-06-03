// CLI scan pipeline. Phase 4: composes every Phase 4 module (config, diff, suppressions, baseline,
// renderers) on top of the Phase 3 walker → parse → buildProjectModel → evaluate skeleton.
//
// D-71 baseline + diff-only compose as independent layers (no special-case logic here).
// D-69 baseline auto-read; D-70 rule-pack drift warning (delegated to detectRulePackDrift, Plan 05).
// D-72 base-ref auto-detect. D-64 parse_candidates_count populated from walker count (Blocker 1).
// D-66 suppressed never count (enforced downstream by countActiveAtOrAbove, Plan 06).
// Engine purity preserved (D-01) — fs / git / yaml live here, never in packages/engine.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import {
  ALL_ADAPTERS,
  buildProjectModel,
  type Config,
  evaluate,
  type Finding,
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
import { ruleInSeverityClassGroup } from "@hookwarden/rules";
import pLimit from "p-limit";
import {
  applyBaseline,
  type BaselineMatcher,
  buildBaselineMatcher,
  detectRulePackDrift,
} from "./baseline/match.js";
import { readBaseline } from "./baseline/read.js";
import { writeBaseline } from "./baseline/write.js";
import type { ResolvedConfig } from "./config/precedence.js";
import { changedFiles } from "./diff/changed-files.js";
import { resolveBaseRef } from "./diff/resolve-base.js";
import { type LoadRulesOptions, loadRulesFromDir } from "./load-rules.js";
import type { IgnoreFilter } from "./suppress/ignore-file.js";
import { loadHookwardenIgnore } from "./suppress/ignore-file.js";
import type { InlineSuppressions } from "./suppress/inline-comments.js";
import { extractInlineSuppressions } from "./suppress/inline-comments.js";
import { detectStale, type StaleSuppression } from "./suppress/stale.js";
import { type WalkResult, walkProject } from "./walker/index.js";
import { discoverN8nInputs } from "./walker/n8n-discovery.js";
import {
  loadGoWasmBytes,
  loadPhpWasmBytes,
  loadPythonWasmBytes,
  loadTreeSitterRuntimeWasmBytes,
} from "./wasm/loader.js";

export interface RunScanInput {
  readonly rootPath: string;
  readonly resolvedConfig: ResolvedConfig;
  readonly diffOnly: boolean;
  readonly diffBase: string | null;
  readonly baselineWrite: boolean;
  readonly verbose: boolean;
  // Phased-rollout filter — when non-null, only rules whose `provider` is in this set run.
  // Validated against PROVIDER_CATALOG at flag-parse time (commands/scan.ts).
  readonly providerFilter?: ReadonlySet<string> | null;
  // Phase 19 v0.7.1 — when non-null, only rules whose class is in the named
  // severity-class group run (e.g. "production-bypass"). Filters rules like
  // providerFilter, so findings AND --fail-on both respect it. Validated
  // against SEVERITY_CLASS_GROUP_NAMES at flag-parse time (commands/scan.ts).
  readonly severityClassGroup?: string | null;
  // User-supplied gitignore-style globs from --exclude / --include. Comma-split + trimmed
  // in commands/scan.ts; empty arrays = no-op.
  readonly excludeGlobs?: ReadonlyArray<string>;
  readonly includeGlobs?: ReadonlyArray<string>;
  // Phase 8.2 D-11 condition 5: fileList override unblocks the rescan loop.
  // When provided (non-empty), the file walker is BYPASSED and only these
  // paths are parsed + analysed. Each path is resolved relative to rootPath
  // and rejected if it escapes the repo root (path-traversal defense).
  readonly fileList?: ReadonlyArray<string>;
}

export interface RunScanOutput {
  readonly result: ScanResult;
  readonly ruleSet: RuleSet;
  readonly durationMs: number;
  readonly walkResult: WalkResult;
  readonly stale: ReadonlyArray<StaleSuppression>;
  readonly preExistingCount: number;
  readonly suppressedCount: number;
  readonly diffBase: string | null;
  readonly rulePackDrift: { readonly from: string; readonly to: string } | null;
  readonly engineError: Error | null;
}

const PYTHON_EXTS: ReadonlySet<string> = new Set([".py", ".pyi"]);
const PHP_EXTS: ReadonlySet<string> = new Set([".php"]);
const GO_EXTS: ReadonlySet<string> = new Set([".go"]);

function isPython(filePath: string): boolean {
  const idx = filePath.lastIndexOf(".");
  if (idx < 0) return false;
  return PYTHON_EXTS.has(filePath.slice(idx).toLowerCase());
}

function isPhp(filePath: string): boolean {
  const idx = filePath.lastIndexOf(".");
  if (idx < 0) return false;
  return PHP_EXTS.has(filePath.slice(idx).toLowerCase());
}

function isGo(filePath: string): boolean {
  const idx = filePath.lastIndexOf(".");
  if (idx < 0) return false;
  return GO_EXTS.has(filePath.slice(idx).toLowerCase());
}

// Phase 8.2 fileList override: bypass the full walker when caller provides an
// explicit list of paths. All paths must resolve inside the repoRoot — path
// traversal is rejected loudly.
function buildFileListWalkResult(scanDir: string, fileList: ReadonlyArray<string>): WalkResult {
  const absFiles: string[] = [];
  for (const entry of fileList) {
    const abs = path.resolve(scanDir, entry);
    const rel = path.relative(scanDir, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(
        `runScan: fileList entry "${entry}" escapes repoRoot (resolved to ${abs}); refusing`,
      );
    }
    absFiles.push(abs);
  }
  return {
    files: absFiles,
    skipped_count: 0,
    total_files_count: absFiles.length,
    parsed_files_count_estimate: absFiles.length,
    oversized_count: 0,
    symlink_count: 0,
    test_excluded_count: 0,
  };
}

// Per-finding suppression annotator. Inline > ignore > baseline (D-63 precedence).
// Returns a sibling drift_note when baseline matched on hash but file_path drifted (D-68).
function annotateOne(
  f: Finding,
  inline: InlineSuppressions,
  ignoreFilter: IgnoreFilter | null,
  matcher: BaselineMatcher | null,
): { finding: Finding; drift_note: string | null } {
  // 1. Inline match: file + line + rule_id present in perLine map.
  const fileLineMap = inline.perLine.get(f.file_path);
  const lineSet = fileLineMap?.get(f.location.line);
  if (lineSet?.has(f.rule_id)) {
    return { finding: { ...f, suppressed: { source: "inline" } }, drift_note: null };
  }
  // 2. Ignore match: file_path matches a pattern.
  if (ignoreFilter !== null) {
    const pattern = ignoreFilter.matches(f.file_path);
    if (pattern !== null) {
      return { finding: { ...f, suppressed: { source: "ignore", pattern } }, drift_note: null };
    }
  }
  // 3. Baseline match (Plan 04-05 hoisted matcher) — returns drift_note for stderr emission.
  if (matcher !== null) {
    return applyBaseline(f, matcher);
  }
  return { finding: { ...f, suppressed: null }, drift_note: null };
}

// runScan is the scan-pipeline orchestrator (walk → parse → load rules →
// build model → evaluate → annotate with inline/ignore/baseline →
// drift-detect → emit). Each step has its own well-tested unit in a
// sibling module; splitting the orchestrator further would shuffle
// complexity into satellite helpers without reducing the true cognitive
// surface of "what the scan does end-to-end." Refactor only if a step
// grows enough to warrant a phase boundary (e.g., async background-worker
// plan splits parse + evaluate).
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: see comment above
export async function runScan(input: RunScanInput): Promise<RunScanOutput> {
  const t0 = performance.now();
  const root = path.resolve(input.rootPath);
  // For single-file scan targets, anything resolved relative to "the scan
  // root" (baseline path, .hookwardenignore lookup, diff-only base ref)
  // must be anchored to the file's parent directory, not the file itself.
  // Otherwise `path.resolve(root, ".hookwarden.baseline.json")` produces
  // `<file>.ts/.hookwarden.baseline.json` and Node's fs throws ENOTDIR.
  // The walker handles the file-vs-directory split internally.
  let scanDir = root;
  try {
    const st = await fs.lstat(root);
    if (st.isFile()) scanDir = path.dirname(root);
  } catch {
    // Non-existent path — let the walker / baseline reader surface the
    // user-facing error in their own well-tested codepaths.
  }
  let engineError: Error | null = null;

  // [INSERT 1] diff-only resolution → pre-walk file-set filter (Plan 03 + CLI-08)
  let diffFileSet: ReadonlySet<string> | null = null;
  let resolvedDiffBase: string | null = null;
  if (input.diffOnly) {
    const explicitFlag = input.diffBase ?? input.resolvedConfig.diff_base ?? null;
    const baseRef = resolveBaseRef(
      explicitFlag !== null
        ? { explicitFlag, env: process.env, cwd: root }
        : { env: process.env, cwd: root },
    );
    resolvedDiffBase = baseRef.ref;
    diffFileSet = changedFiles(baseRef.ref, root);
  }

  // fileList override: Phase 8.2 rescan path. Helper at top of file.
  let walkResult: WalkResult;
  if (input.fileList !== undefined && input.fileList.length > 0) {
    walkResult = buildFileListWalkResult(scanDir, input.fileList);
  } else {
    const fullWalk = await walkProject({
      rootPath: root,
      scanTests: input.resolvedConfig.scan_tests,
      ...(input.excludeGlobs !== undefined ? { excludeGlobs: input.excludeGlobs } : {}),
      ...(input.includeGlobs !== undefined ? { includeGlobs: input.includeGlobs } : {}),
    });
    // Filter walkResult.files by diffFileSet when diff-only is active. The narrowed set IS the
    // candidate set for THIS run — `parse_candidates_count` reflects that so the parse-coverage
    // gate's denominator is honest under --diff-only.
    const walkedFiles: ReadonlyArray<string> = diffFileSet
      ? fullWalk.files.filter((abs) => diffFileSet.has(path.relative(scanDir, abs)))
      : fullWalk.files;
    walkResult = {
      ...fullWalk,
      files: walkedFiles,
      parsed_files_count_estimate: walkedFiles.length,
    };
  }

  // Initialize tree-sitter runtimes once per scan, only when files of that language are present.
  // The web-tree-sitter runtime .wasm (when needed for Bun --compile) is shared across all
  // grammars, so it loads once even if both Python and PHP files appear in the same scan.
  const hasPython = walkResult.files.some(isPython);
  const hasPhp = walkResult.files.some(isPhp);
  const hasGo = walkResult.files.some(isGo);
  let pyRuntime: PythonRuntime | null = null;
  let phpRuntime: PhpRuntime | null = null;
  let goRuntime: GoRuntime | null = null;
  if (hasPython || hasPhp || hasGo) {
    const [pythonWasmBytes, phpWasmBytes, goWasmBytes, treeSitterRuntimeWasmBytes] =
      await Promise.all([
        hasPython ? loadPythonWasmBytes() : Promise.resolve(null),
        hasPhp ? loadPhpWasmBytes() : Promise.resolve(null),
        hasGo ? loadGoWasmBytes() : Promise.resolve(null),
        loadTreeSitterRuntimeWasmBytes(),
      ]);
    if (hasPython && pythonWasmBytes !== null) {
      pyRuntime = await initPythonRuntime(
        treeSitterRuntimeWasmBytes !== undefined
          ? { wasmBytes: pythonWasmBytes, treeSitterRuntimeWasmBytes }
          : { wasmBytes: pythonWasmBytes },
      );
    }
    if (hasPhp && phpWasmBytes !== null) {
      phpRuntime = await initPhpRuntime(
        treeSitterRuntimeWasmBytes !== undefined
          ? { wasmBytes: phpWasmBytes, treeSitterRuntimeWasmBytes }
          : { wasmBytes: phpWasmBytes },
      );
    }
    if (hasGo && goWasmBytes !== null) {
      goRuntime = await initGoRuntime(
        treeSitterRuntimeWasmBytes !== undefined
          ? { wasmBytes: goWasmBytes, treeSitterRuntimeWasmBytes }
          : { wasmBytes: goWasmBytes },
      );
    }
  }

  const concurrency = Math.min(8, os.availableParallelism?.() ?? 4);
  const limit = pLimit(concurrency);

  const parsedFiles: ParsedFile[] = await Promise.all(
    walkResult.files.map((abs) =>
      limit(async () => {
        const rel = path.relative(scanDir, abs);
        const sourceText = await fs.readFile(abs, "utf-8");
        if (isGo(abs)) {
          if (goRuntime === null) throw new Error("Go runtime not initialized");
          return parseGo({ file_path: rel, source_text: sourceText }, goRuntime);
        }
        if (isPhp(abs)) {
          if (phpRuntime === null) throw new Error("PHP runtime not initialized");
          return parsePhp({ file_path: rel, source_text: sourceText }, phpRuntime);
        }
        if (isPython(abs)) {
          if (pyRuntime === null) throw new Error("Python runtime not initialized");
          return parsePython({ file_path: rel, source_text: sourceText }, pyRuntime);
        }
        return parseJsTs({ file_path: rel, source_text: sourceText });
      }),
    ),
  );

  const loadOpts: LoadRulesOptions =
    input.resolvedConfig.rules_dir !== null ? { rulesDir: input.resolvedConfig.rules_dir } : {};
  let ruleSet: RuleSet;
  try {
    ruleSet = await loadRulesFromDir(loadOpts);
  } catch (e) {
    engineError = e instanceof Error ? e : new Error(String(e));
    return emptyOutput(walkResult, t0, engineError);
  }
  // Provider filter — phased rollout. Filters BOTH which findings emit AND which contribute
  // to --fail-on, because evaluate() only runs rules in ruleSet.rules.
  const providerFilter = input.providerFilter ?? null;
  if (providerFilter !== null) {
    ruleSet = {
      ...ruleSet,
      rules: ruleSet.rules.filter((r) => providerFilter.has(r.provider)),
    };
  }
  // Severity-class filter (Phase 19 v0.7.1) — same rule-level filtering as
  // providerFilter so excluded classes neither emit findings nor count toward
  // --fail-on. The group name is validated at flag-parse time.
  const severityClassGroup = input.severityClassGroup ?? null;
  if (severityClassGroup !== null) {
    ruleSet = {
      ...ruleSet,
      rules: ruleSet.rules.filter((r) => ruleInSeverityClassGroup(r.rule_id, severityClassGroup)),
    };
  }

  const config: Config = {
    reachability_max_depth: 3,
    scanned_at: new Date().toISOString(),
    engine_commit_sha: null,
    total_files_count: walkResult.total_files_count,
  };

  // Phase 24 (AGENT-01) — n8n I/O seam. The engine is pure (D-03) and never reads files; the CLI
  // discovers *.workflow.json source text + the package.json#n8n.nodes signal here and hands them
  // to buildProjectModel. The engine content-sniffs each workflow (isN8nWorkflow) — a random
  // *.workflow.json yields zero handlers (FP moat). Discovery is best-effort (never throws), so a
  // non-n8n project pays only one cheap glob + package.json read and gets an empty result.
  // fileList override (Phase 8.2 rescan) bypasses the full walk; skip n8n discovery there too —
  // the rescan loop targets explicit code paths, not whole-project workflow discovery.
  const n8nInputs =
    input.fileList !== undefined && input.fileList.length > 0
      ? { workflowFiles: [], customNodeSignal: false }
      : await discoverN8nInputs(scanDir);

  let rawResult: ScanResult;
  try {
    const model: ProjectModel = await buildProjectModel({
      parsedFiles,
      ruleSet,
      config,
      bespokeAdapters: ALL_ADAPTERS,
      workflowFiles: n8nInputs.workflowFiles,
      customNodeSignal: n8nInputs.customNodeSignal,
    });
    rawResult = await evaluate(model, ruleSet, config);
  } catch (e) {
    engineError = e instanceof Error ? e : new Error(String(e));
    return emptyOutput(walkResult, t0, engineError, ruleSet);
  }

  // [INSERT 1.5] Blocker 1 — populate ScanMetadata.parse_candidates_count from the walker count.
  // Engine emits parse_candidates_count: 0 as a safe placeholder (see packages/engine/src/evaluate.ts).
  // Failing to override here silently neuters the parse-coverage gate (evaluateParseCoverage divides
  // by 0; ratio becomes Infinity/NaN; the gate never trips regardless of actual coverage).
  const result: ScanResult = {
    ...rawResult,
    metadata: {
      ...rawResult.metadata,
      parse_candidates_count: walkResult.files.length,
    },
  };

  // [INSERT 2] suppression annotation post-emit (Plan 04 + CLI-06/07/10)
  // Baseline path defaults to a relative file name; resolve against the scan root, not process.cwd(),
  // so a CLI invocation with `path` ≠ cwd reads/writes the baseline next to the scanned project.
  const baselineAbsPath = path.isAbsolute(input.resolvedConfig.baseline_path)
    ? input.resolvedConfig.baseline_path
    : path.resolve(scanDir, input.resolvedConfig.baseline_path);
  const inline = extractInlineSuppressions(parsedFiles);
  const ignoreFilter = await loadHookwardenIgnore(scanDir);
  const baselineDoc = input.resolvedConfig.baseline_enabled
    ? await readBaseline(baselineAbsPath)
    : null;
  const baselineMatcher = baselineDoc !== null ? buildBaselineMatcher(baselineDoc) : null;

  // Warning 11 — call detectRulePackDrift; do NOT duplicate the message literal here.
  let rulePackDrift: { from: string; to: string } | null = null;
  if (baselineDoc !== null) {
    const driftMessage = detectRulePackDrift(baselineDoc, ruleSet.rule_pack_version);
    if (driftMessage !== null) {
      rulePackDrift = {
        from: baselineDoc.rule_pack_version,
        to: ruleSet.rule_pack_version,
      };
      process.stderr.write(`${driftMessage}\n`);
    }
  }

  const annotated: Finding[] = [];
  const driftNotes: string[] = [];
  for (const f of result.findings) {
    const r = annotateOne(f, inline, ignoreFilter, baselineMatcher);
    annotated.push(r.finding);
    if (r.drift_note !== null) driftNotes.push(r.drift_note);
  }
  // Emit each unique drift note once.
  for (const note of new Set(driftNotes)) {
    process.stderr.write(`${note}\n`);
  }

  const annotatedResult: ScanResult = { ...result, findings: annotated };
  const stale = detectStale(annotated, inline, ignoreFilter, baselineDoc);
  const preExistingCount = annotated.filter((f) => f.suppressed?.source === "baseline").length;
  const suppressedCount = annotated.filter((f) => f.suppressed != null).length;

  // [INSERT 3] baseline write — explicit flag only (Plan 05 + D-69 explicit-write)
  if (input.baselineWrite) {
    await writeBaseline(baselineAbsPath, annotatedResult, input.diffOnly);
  }

  const durationMs = performance.now() - t0;
  return {
    result: annotatedResult,
    ruleSet,
    durationMs,
    walkResult,
    stale,
    preExistingCount,
    suppressedCount,
    diffBase: resolvedDiffBase,
    rulePackDrift,
    engineError: null,
  };
}

function emptyOutput(
  walkResult: WalkResult,
  t0: number,
  engineError: Error,
  ruleSet?: RuleSet,
): RunScanOutput {
  const emptyMeta = {
    engine_version: "0.0.0",
    engine_commit_sha: null,
    rule_pack_version: "0.0.0",
    rule_pack_content_hash: "sha256:0",
    scanned_at: new Date().toISOString(),
    parse_errors_count: 0,
    parsed_files_count: 0,
    total_files_count: walkResult.total_files_count,
    parse_candidates_count: walkResult.files.length,
  };
  const emptyResult: ScanResult = { findings: [], inventory: [], metadata: emptyMeta };
  const emptyRuleSet: RuleSet = ruleSet ?? {
    schema_version: 1,
    rule_pack_version: "0.0.0",
    providers: {},
    rules: [],
    predicates: {},
  };
  return {
    result: emptyResult,
    ruleSet: emptyRuleSet,
    durationMs: performance.now() - t0,
    walkResult,
    stale: [],
    preExistingCount: 0,
    suppressedCount: 0,
    diffBase: null,
    rulePackDrift: null,
    engineError,
  };
}
