// Node-only Python WASM loader. Stripped down from
// packages/cli/src/wasm/loader.ts — MCP does NOT ship a `bun build --compile`
// binary in v0.8.0 (deferred per CONTEXT.md), so the Bun-runtime branch and
// the PHP branch are both dropped here.
//
// The compiled file at dist/wasm/loader.js walks two levels up to
// packages/mcp/, then into wasm/ where scripts/sync-wasm.mjs copies
// tree-sitter-python.wasm at install time.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export async function loadPythonWasmBytes(): Promise<Uint8Array> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const wasmPath = path.join(__dirname, "..", "..", "wasm", "tree-sitter-python.wasm");
  const buf = await fs.readFile(wasmPath);
  return new Uint8Array(buf);
}
