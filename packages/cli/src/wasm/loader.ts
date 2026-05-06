// Dual-path WASM loader for tree-sitter-python.wasm. Phase 4.2 DC-13.
//
// Bun branch (compiled `bun build --compile` binary):
//   Dynamically imports ./bun-asset.js, which holds the Bun-only asset import.
//   Splitting the Bun import into its own module keeps Vitest's WASM plugin
//   from trying to resolve the `.wasm` import attribute it doesn't support.
//
// Node branch (vitest + pnpm dev):
//   Reads from packages/cli/wasm/tree-sitter-python.wasm (populated by
//   scripts/sync-wasm.mjs at pnpm install time).
//
// Both branches resolve to the same physical artifact — single source of truth.
// Engine purity (Phase 1 D-01) preserved: engine/parsers/python-loader.ts is
// unmodified.

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
