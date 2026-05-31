// Phase 24 (AGENT-01) — CLI I/O seam that surfaces the two n8n inputs the pure engine
// (buildProjectModel) consumes but never reads itself (D-03 — engine never touches fs):
//
//   1. `workflowFiles` — raw `*.workflow.json` source text. The engine content-sniffs each
//      via isN8nWorkflow; only n8n-shaped documents (nodes[] + connections + n8n-nodes-base.*
//      type strings) route through n8nAdapter into synthetic handlers. A random `*.workflow.json`
//      yields zero handlers (FP moat — glob presence alone never fires).
//   2. `customNodeSignal` — true when the scanned project's package.json declares `n8n.nodes`
//      (the n8n community-node convention). Tags the project's TS handlers provider:n8n so the
//      detector-2 rule applies to them.
//
// The standard code walker (walker/index.ts) intentionally allowlists only code extensions
// (.ts/.py/.php/...) — `*.workflow.json` is NOT code and must not be fed to the JS/TS parser.
// So this module discovers the workflow JSON separately and hands the raw text to the engine.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { glob } from "tinyglobby";

export interface N8nWorkflowFileInput {
  readonly file_path: string; // scan-root-relative
  readonly source_text: string; // raw *.workflow.json text — engine content-sniffs it
}

export interface N8nDiscovery {
  readonly workflowFiles: ReadonlyArray<N8nWorkflowFileInput>;
  readonly customNodeSignal: boolean;
}

// Mirror walker/index.ts HARD_SKIP_DIRS so workflow discovery does not descend into
// vendored / build output directories (a `dist/**/*.workflow.json` is a build artifact).
const SKIP_GLOBS: ReadonlyArray<string> = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/coverage/**",
  "**/.venv/**",
  "**/venv/**",
  "**/__pycache__/**",
  "**/.pytest_cache/**",
  "**/vendor/**",
  "**/target/**",
  "**/.git/**",
];

const MAX_WORKFLOW_BYTES = 5 * 1024 * 1024; // 5 MB cap — n8n exports are small; guard against giants.

// readCustomNodeSignal reads <scanDir>/package.json and returns true iff it declares a non-empty
// `n8n.nodes` array (the n8n community/custom-node convention). Absent / malformed package.json
// => false (no signal; never throws — discovery is best-effort and must not fail the scan).
async function readCustomNodeSignal(scanDir: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(path.join(scanDir, "package.json"), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return false;
    const n8n = (parsed as { n8n?: unknown }).n8n;
    if (typeof n8n !== "object" || n8n === null) return false;
    const nodes = (n8n as { nodes?: unknown }).nodes;
    return Array.isArray(nodes) && nodes.length > 0;
  } catch {
    return false;
  }
}

// discoverN8nInputs walks `scanDir` for `*.workflow.json` files and reads the project
// package.json#n8n.nodes signal. Pure I/O (the engine stays pure). Best-effort: any unreadable
// file is skipped silently so a malformed fixture never aborts the scan (the engine's content
// sniff + parse-error path is the authoritative gate, not this discovery step).
export async function discoverN8nInputs(scanDir: string): Promise<N8nDiscovery> {
  let matches: string[];
  try {
    matches = await glob(["**/*.workflow.json"], {
      cwd: scanDir,
      ignore: SKIP_GLOBS,
      dot: false,
      absolute: false,
      onlyFiles: true,
    });
  } catch {
    matches = [];
  }

  const workflowFiles: N8nWorkflowFileInput[] = [];
  for (const rel of matches.sort()) {
    const abs = path.join(scanDir, rel);
    try {
      const st = await fs.lstat(abs);
      if (!st.isFile() || st.size > MAX_WORKFLOW_BYTES) continue;
      const sourceText = await fs.readFile(abs, "utf-8");
      workflowFiles.push({ file_path: rel, source_text: sourceText });
    } catch {
      // Unreadable / vanished between glob and read — skip; never fail the scan.
    }
  }

  const customNodeSignal = await readCustomNodeSignal(scanDir);
  return { workflowFiles, customNodeSignal };
}
