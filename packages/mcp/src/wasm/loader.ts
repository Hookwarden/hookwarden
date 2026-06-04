// Node-only grammar WASM loaders. Stripped down from
// packages/cli/src/wasm/loader.ts — MCP does NOT ship a `bun build --compile`
// binary, so the Bun-runtime / treeSitterRuntimeWasmBytes branch is dropped
// here (emscripten's default locateFile resolves the runtime .wasm under the
// standard npm install layout).
//
// The compiled file at dist/wasm/loader.js walks two levels up to
// packages/mcp/, then into wasm/ where scripts/sync-wasm.mjs copies the
// tree-sitter-{python,php,go}.wasm grammars at install time.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

function wasmDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  return path.join(path.dirname(__filename), "..", "..", "wasm");
}

async function readWasm(fileName: string): Promise<Uint8Array> {
  const buf = await fs.readFile(path.join(wasmDir(), fileName));
  return new Uint8Array(buf);
}

export async function loadPythonWasmBytes(): Promise<Uint8Array> {
  return readWasm("tree-sitter-python.wasm");
}

export async function loadPhpWasmBytes(): Promise<Uint8Array> {
  return readWasm("tree-sitter-php.wasm");
}

export async function loadGoWasmBytes(): Promise<Uint8Array> {
  return readWasm("tree-sitter-go.wasm");
}
