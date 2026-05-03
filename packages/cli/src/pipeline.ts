// CLI scan pipeline shared by `scan` and `inventory` subcommands.
// CLI is the I/O boundary (D-01): all fs reads happen here or in the walker; engine stays pure.

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import {
  buildProjectModel,
  type Config,
  evaluate,
  initPythonRuntime,
  type ParsedFile,
  type ProjectModel,
  type PythonRuntime,
  parseJsTs,
  parsePython,
  type RuleSet,
  type ScanResult,
} from "@hookwarden/engine";
import pLimit from "p-limit";
import { type LoadRulesOptions, loadRulesFromDir } from "./load-rules.js";
import { type WalkResult, walkProject } from "./walker/index.js";

export interface RunScanInput {
  readonly rootPath: string;
  readonly rulesDir?: string;
  readonly verbose?: boolean;
}

export interface RunScanOutput {
  readonly result: ScanResult;
  readonly ruleSet: RuleSet;
  readonly durationMs: number;
  readonly walkResult: WalkResult;
}

const PYTHON_EXTS: ReadonlySet<string> = new Set([".py", ".pyi"]);

function isPython(filePath: string): boolean {
  const idx = filePath.lastIndexOf(".");
  if (idx < 0) return false;
  return PYTHON_EXTS.has(filePath.slice(idx).toLowerCase());
}

// Resolve tree-sitter-python.wasm via Node module resolution. Same pattern as engine tests
// (packages/engine/test/wasm.ts) — works under both workspace and npm flat-install layouts.
async function loadPythonWasmBytes(): Promise<Uint8Array> {
  const req = createRequire(import.meta.url);
  const pkgPath = req.resolve("tree-sitter-python/package.json");
  const wasmPath = path.join(path.dirname(pkgPath), "tree-sitter-python.wasm");
  const buf = await fs.readFile(wasmPath);
  return new Uint8Array(buf);
}

export async function runScan(input: RunScanInput): Promise<RunScanOutput> {
  const t0 = performance.now();
  const root = path.resolve(input.rootPath);
  const walkResult = await walkProject({ rootPath: root });

  // Initialize Python runtime once, only if any Python files are present.
  const hasPython = walkResult.files.some(isPython);
  let pyRuntime: PythonRuntime | null = null;
  if (hasPython) {
    const wasmBytes = await loadPythonWasmBytes();
    pyRuntime = await initPythonRuntime({ wasmBytes });
  }

  const concurrency = Math.min(8, os.availableParallelism?.() ?? 4);
  const limit = pLimit(concurrency);

  const parsedFiles: ParsedFile[] = await Promise.all(
    walkResult.files.map((abs) =>
      limit(async () => {
        const rel = path.relative(root, abs);
        const sourceText = await fs.readFile(abs, "utf-8");
        if (isPython(abs)) {
          if (pyRuntime === null) throw new Error("Python runtime not initialized");
          return parsePython({ file_path: rel, source_text: sourceText }, pyRuntime);
        }
        return parseJsTs({ file_path: rel, source_text: sourceText });
      }),
    ),
  );

  const loadOpts: LoadRulesOptions =
    input.rulesDir !== undefined ? { rulesDir: input.rulesDir } : {};
  const ruleSet = await loadRulesFromDir(loadOpts);
  const config: Config = {
    reachability_max_depth: 3,
    scanned_at: new Date().toISOString(),
    engine_commit_sha: null,
    total_files_count: walkResult.total_files_count,
  };
  const model: ProjectModel = await buildProjectModel({
    parsedFiles,
    ruleSet,
    config,
  });
  const result = await evaluate(model, ruleSet, config);

  const durationMs = performance.now() - t0;
  return { result, ruleSet, durationMs, walkResult };
}
