// Dual-path WASM loader for tree-sitter grammar .wasm artefacts. Phase 4.2 DC-13.
//
// Bun branch (compiled `bun build --compile` binary):
//   Dynamically imports ./bun-asset.js, which holds the Bun-only asset import.
//   Splitting the Bun import into its own module keeps Vitest's WASM plugin
//   from trying to resolve the `.wasm` import attribute it doesn't support.
//
// Node branch (vitest + pnpm dev):
//   Reads from packages/cli/wasm/tree-sitter-{python,php}.wasm (populated by
//   scripts/sync-wasm.mjs at pnpm install time).
//
// Both branches resolve to the same physical artifact — single source of truth.
// Engine purity (Phase 1 D-01) preserved: engine/parsers/{python,php}-loader.ts
// is unmodified.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

declare const Bun: undefined | { file: (p: string) => { bytes: () => Promise<Uint8Array> } };

function isBunRuntime(): boolean {
  return typeof Bun !== "undefined" && typeof process.versions["bun"] === "string";
}

export async function loadPythonWasmBytes(): Promise<Uint8Array> {
  if (isBunRuntime()) {
    const { loadBunEmbeddedWasm } = await import("./bun-asset.js");
    return await loadBunEmbeddedWasm();
  }

  // Node branch: from dist/wasm/loader.js or src/wasm/loader.ts, walk two
  // levels up to packages/cli/, then into wasm/. Path-walk depth verified
  // against build-output snapshot in 04.2-CONTEXT.md (W5/B2).
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const wasmPath = path.join(__dirname, "..", "..", "wasm", "tree-sitter-python.wasm");
  const buf = await fs.readFile(wasmPath);
  return new Uint8Array(buf);
}

// Mirrors loadPythonWasmBytes — same dual-path shape for tree-sitter-php.wasm.
// Phase 8.1 D-10 + Phase 4.2 DC-13. The PHP grammar artefact is populated by
// the same scripts/sync-wasm.mjs invocation that populates the Python one.
export async function loadPhpWasmBytes(): Promise<Uint8Array> {
  if (isBunRuntime()) {
    const { loadBunEmbeddedPhpWasm } = await import("./bun-asset.js");
    return await loadBunEmbeddedPhpWasm();
  }
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const wasmPath = path.join(__dirname, "..", "..", "wasm", "tree-sitter-php.wasm");
  const buf = await fs.readFile(wasmPath);
  return new Uint8Array(buf);
}

// Mirrors loadPythonWasmBytes / loadPhpWasmBytes — same dual-path shape for
// tree-sitter-go.wasm. Phase 27 ENG-GO-01. The Go grammar artefact is populated
// by the same scripts/sync-wasm.mjs invocation that populates the Python/PHP ones.
export async function loadGoWasmBytes(): Promise<Uint8Array> {
  if (isBunRuntime()) {
    const { loadBunEmbeddedGoWasm } = await import("./bun-asset.js");
    return await loadBunEmbeddedGoWasm();
  }
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const wasmPath = path.join(__dirname, "..", "..", "wasm", "tree-sitter-go.wasm");
  const buf = await fs.readFile(wasmPath);
  return new Uint8Array(buf);
}

// Loads the bytes of `web-tree-sitter.wasm` (the tree-sitter runtime itself).
// Returns `undefined` in Node mode — web-tree-sitter's emscripten loader finds
// its own .wasm via the npm install layout, no caller intervention needed.
// Returns embedded bytes in Bun --compile mode where /$bunfs/ has no .wasm
// for the runtime to discover. The CLI passes the bytes (or undefined) into
// engine.initPythonRuntime, which forwards to Parser.init({ wasmBinary }).
export async function loadTreeSitterRuntimeWasmBytes(): Promise<Uint8Array | undefined> {
  if (isBunRuntime()) {
    const { loadBunEmbeddedWebTreeSitterRuntimeWasm } = await import("./bun-asset.js");
    return await loadBunEmbeddedWebTreeSitterRuntimeWasm();
  }
  return undefined;
}
