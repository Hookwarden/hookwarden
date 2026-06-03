// `hookwarden fix [path]` subcommand. Phase 8.2 D-16 + D-17 + D-22.
//
// Wraps @hookwarden/fix's applyFixes/dryRunFixes. Dry-run is the default;
// --write opt-in mutates files via the atomic-staging path. --format json
// forces dry-run (D-17).

import { promises as fs, statSync } from "node:fs";
import * as path from "node:path";
import {
  type GoRuntime,
  initGoRuntime,
  initPhpRuntime,
  initPythonRuntime,
  type ParsedFile,
  type PhpRuntime,
  type PythonRuntime,
  parseGo,
  parseJsTs,
  parsePhp,
  parsePython,
} from "@hookwarden/engine";
import {
  applyFixes,
  dryRunFixes,
  FixModeNonTtyRejectedError,
  type FixOptions,
  type FixResult,
} from "@hookwarden/fix";
import {
  commitStaging,
  createStagingRun,
  ensureGitignoreEntry,
  stageFile,
} from "@hookwarden/fix/staging";
import { ALL_CODEGEN_ROUTINES } from "@hookwarden/rules";
import { defineCommand } from "citty";
import { ConfigError, loadConfigFromCwd } from "../config/loader.js";
import { type ResolvedConfig, resolveConfig } from "../config/precedence.js";
import { runScan } from "../pipeline.js";
import { shouldUseAnsi } from "../walker/tty.js";
import { loadGoWasmBytes, loadPhpWasmBytes, loadPythonWasmBytes } from "../wasm/loader.js";

export interface FixArgs {
  readonly path?: string;
  readonly write?: boolean;
  readonly mode?: string;
  readonly only?: string;
  readonly format?: string;
  readonly "accept-unsafe"?: boolean;
  readonly "no-color"?: boolean;
  readonly "rules-dir"?: string;
}

const VALID_FIX_MODE: ReadonlySet<string> = new Set(["safe", "all", "manual-only-explain"]);
const VALID_FIX_FORMAT: ReadonlySet<string> = new Set(["text", "json"]);

export async function runFixCommand(args: FixArgs): Promise<number> {
  // Step 0 — value validation (D-17 + D-12).
  if (args.mode !== undefined && !VALID_FIX_MODE.has(args.mode)) {
    process.stderr.write(
      `error: --mode must be one of safe|all|manual-only-explain (got "${args.mode}")\n`,
    );
    return 3;
  }
  if (args.format !== undefined && !VALID_FIX_FORMAT.has(args.format)) {
    process.stderr.write(`error: --format must be one of text|json (got "${args.format}")\n`);
    return 3;
  }
  const mode = (args.mode ?? "safe") as FixOptions["mode"];
  const format = (args.format ?? "text") as "text" | "json";
  // D-17: --format json forces dry-run; emit a stderr warning if --write was also passed.
  const dryRun = args.write !== true || format === "json";
  if (args.write === true && format === "json") {
    process.stderr.write("warning: --format json forces dry-run; --write is ignored (D-17)\n");
  }
  const noColor = args["no-color"] === true;
  const useAnsi = noColor ? false : shouldUseAnsi(process.stdout);
  const isTty = process.stdout.isTTY === true && process.env["HOOKWARDEN_NO_TTY"] !== "1";

  // Step 1 — Config + scan target.
  // `fix path/to/handler.js` is valid: scan the file directly, but resolve config, the touched
  // files (whose paths are reported relative to the scanned directory), and the staging dir
  // against the file's PARENT directory. Using the file path itself as the base made
  // path.join() produce bogus paths, so the codegen never re-parsed the file → "0 fixable
  // findings" on any single-file invocation.
  const rootPath = path.resolve(args.path ?? ".");
  let isDir = false;
  try {
    isDir = statSync(rootPath).isDirectory();
  } catch {
    // Path doesn't exist — the scan step reports it; don't crash here.
  }
  const baseDir = isDir ? rootPath : path.dirname(rootPath);
  const cwd = baseDir;
  let resolvedConfig: ResolvedConfig;
  try {
    const configResult = await loadConfigFromCwd({ cwd, disabled: false });
    resolvedConfig = resolveConfig(
      args["rules-dir"] !== undefined ? { rules_dir: args["rules-dir"] } : {},
      process.env,
      configResult.config,
    );
  } catch (e) {
    if (e instanceof ConfigError) {
      process.stderr.write(`error: ${e.message}\n`);
      return 3;
    }
    throw e;
  }

  // Step 2 — Initial scan.
  const scanOutput = await runScan({
    rootPath,
    resolvedConfig,
    diffOnly: false,
    diffBase: null,
    baselineWrite: false,
    verbose: false,
  });
  if (scanOutput.engineError !== null) {
    process.stderr.write(`error: ${scanOutput.engineError.message}\n`);
    return 2;
  }

  // Step 3 — Re-parse the touched files so the codegen routines can run.
  const touchedFiles = uniqueFilePaths(scanOutput.result.findings);
  const parsedFiles = await parseFilesByPath(cwd, touchedFiles);

  // Step 4 — Compose FixOptions + invoke the orchestrator.
  const opts: FixOptions = {
    mode,
    write: !dryRun,
    isTty,
    ...(args["accept-unsafe"] !== undefined ? { acceptUnsafe: args["accept-unsafe"] } : {}),
    ...(args.only !== undefined ? { only: args.only.split(",").map((s) => s.trim()) } : {}),
    format,
  };
  const context = {
    parsedFiles,
    codegenRegistry: ALL_CODEGEN_ROUTINES,
  };

  let result: FixResult;
  try {
    result = dryRun
      ? await dryRunFixes(scanOutput.result, scanOutput.ruleSet, opts, context)
      : await applyFixes(scanOutput.result, scanOutput.ruleSet, opts, context);
  } catch (e) {
    if (e instanceof FixModeNonTtyRejectedError) {
      // D-12 verbatim user-visible message — lives in the CLI handler only.
      process.stderr.write("error: --mode all in non-TTY requires --accept-unsafe (D-12)\n");
      return 3;
    }
    process.stderr.write(`error: ${(e as Error).message}\n`);
    return 2;
  }

  // Step 5 — Conflict detection short-circuit.
  if (result.suggestion !== null) {
    process.stderr.write(result.suggestion);
    return 3;
  }

  // Step 6 — Apply via atomic staging when --write.
  if (!dryRun && result.fixes.length > 0) {
    await ensureGitignoreEntry(cwd);
    const run = await createStagingRun(cwd);
    // Group edits by file, build the post-edit source per file, then stage.
    const editsByFile = new Map<string, typeof result.fixes>();
    for (const edit of result.fixes) {
      const list = editsByFile.get(edit.filePath) ?? [];
      (list as Array<typeof edit>).push(edit);
      editsByFile.set(edit.filePath, list);
    }
    for (const [filePath, edits] of editsByFile) {
      const original = await fs.readFile(path.join(cwd, filePath), "utf-8");
      const next = applyEditsInPlace(original, [...edits]);
      await stageFile(run, filePath, next);
    }
    await commitStaging(run);
  }

  // Step 7 — Render output.
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(buildJsonSchema(result), null, 2)}\n`);
  } else {
    renderTextResult(result, useAnsi);
  }

  return 0;
}

function uniqueFilePaths(findings: ReadonlyArray<{ readonly file_path: string }>): string[] {
  return [...new Set(findings.map((f) => f.file_path))];
}

async function parseFilesByPath(
  cwd: string,
  files: ReadonlyArray<string>,
): Promise<Readonly<Record<string, ParsedFile>>> {
  const out: Record<string, ParsedFile> = {};
  let pyRuntime: PythonRuntime | null = null;
  let phpRuntime: PhpRuntime | null = null;
  let goRuntime: GoRuntime | null = null;
  const ext = (f: string) => f.slice(f.lastIndexOf(".")).toLowerCase();
  const needPython = files.some((f) => ext(f) === ".py" || ext(f) === ".pyi");
  const needPhp = files.some((f) => ext(f) === ".php");
  const needGo = files.some((f) => ext(f) === ".go");
  if (needPython) {
    const bytes = await loadPythonWasmBytes();
    if (bytes !== null) pyRuntime = await initPythonRuntime({ wasmBytes: bytes });
  }
  if (needPhp) {
    const bytes = await loadPhpWasmBytes();
    if (bytes !== null) phpRuntime = await initPhpRuntime({ wasmBytes: bytes });
  }
  if (needGo) {
    const bytes = await loadGoWasmBytes();
    if (bytes !== null) goRuntime = await initGoRuntime({ wasmBytes: bytes });
  }
  for (const rel of files) {
    const abs = path.join(cwd, rel);
    let source: string;
    try {
      source = await fs.readFile(abs, "utf-8");
    } catch {
      continue;
    }
    const e = ext(rel);
    if (e === ".py" || e === ".pyi") {
      if (pyRuntime === null) continue;
      out[rel] = await parsePython({ file_path: rel, source_text: source }, pyRuntime);
    } else if (e === ".php") {
      if (phpRuntime === null) continue;
      out[rel] = await parsePhp({ file_path: rel, source_text: source }, phpRuntime);
    } else if (e === ".go") {
      if (goRuntime === null) continue;
      out[rel] = await parseGo({ file_path: rel, source_text: source }, goRuntime);
    } else {
      out[rel] = await parseJsTs({ file_path: rel, source_text: source });
    }
  }
  return out;
}

function applyEditsInPlace(
  source: string,
  edits: Array<{ startByte: number; endByte: number; after: string }>,
): string {
  const sorted = [...edits].sort((a, b) => b.startByte - a.startByte);
  let result = source;
  for (const e of sorted) {
    result = result.slice(0, e.startByte) + e.after + result.slice(e.endByte);
  }
  return result;
}

function buildJsonSchema(result: FixResult): unknown {
  return {
    version: "1.0",
    schema_url: "https://hookwarden.dev/schemas/fix-output.v1.json",
    fixes: result.fixes.map((f) => ({
      rule_id: f.ruleId,
      safety: f.safety,
      file: f.filePath,
      range: { start: f.start, end: f.end },
      before: f.before,
      after: f.after,
      applied: false,
    })),
    summary: {
      fixable: result.fixes.length,
      applied: result.applied,
      skipped: result.skipped,
      rejected: result.rejected.length,
    },
  };
}

function renderTextResult(result: FixResult, useAnsi: boolean): void {
  const open = useAnsi ? "\x1b[36m" : "";
  const close = useAnsi ? "\x1b[0m" : "";
  process.stdout.write(`${open}hookwarden fix${close} — ${result.fixes.length} fixable findings\n`);
  for (const fix of result.fixes) {
    process.stdout.write(`  ${fix.filePath}:${fix.start.line}:${fix.start.col}  ${fix.ruleId}\n`);
    process.stdout.write(`    - ${fix.before}\n`);
    process.stdout.write(`    + ${fix.after.trim()}\n`);
  }
  if (result.rejected.length > 0) {
    process.stdout.write(`\n${result.rejected.length} fixes rejected:\n`);
    for (const r of result.rejected) {
      process.stdout.write(`  - ${r.edit.ruleId}: ${r.reason}\n`);
    }
  }
}

export const fixCommand = defineCommand({
  meta: {
    name: "fix",
    description: "Apply mechanical fixes for safety:safe findings (dry-run by default).",
  },
  args: {
    path: { type: "positional", required: false, default: "." },
    write: {
      type: "boolean",
      description: "Write fixes to disk via atomic staging. Default: dry-run.",
    },
    mode: { type: "string", description: "safe | all | manual-only-explain (default: safe)" },
    only: { type: "string", description: "Comma-separated rule IDs to filter." },
    format: {
      type: "string",
      description: "Output format: text | json. --format json forces dry-run.",
    },
    "accept-unsafe": { type: "boolean", description: "Required for --mode all in non-TTY (D-12)." },
    "no-color": { type: "boolean" },
    "rules-dir": { type: "string", description: "Override the bundled rule pack (dev-only)." },
  },
  run: async ({ args }) => runFixCommand(args as FixArgs),
});
