// Bun-only asset imports for the two .wasm files that ship as embedded assets
// in the compiled binary:
//   1. tree-sitter-python.wasm — the Python grammar (sourced from the
//      tree-sitter-python npm package via packages/cli/scripts/sync-wasm.mjs).
//   2. web-tree-sitter.wasm — the tree-sitter runtime itself, normally loaded
//      by web-tree-sitter via emscripten's filesystem-based locateFile mechanism.
//      In a Bun --compile binary, the runtime can't read its own .wasm off
//      disk because /$bunfs/ is virtual, so we embed it here and pass the
//      bytes to Parser.init({ wasmBinary }).
//
// This file is dynamically imported ONLY from the Bun branch of loader.ts.
// Vitest (Vite-based) never loads it because the Node branch is the only one
// taken in test environments — keeps Vite's WASM-ESM plugin from trying to
// resolve the `.wasm` import attribute it doesn't support.

declare const Bun: { file: (p: string) => { bytes: () => Promise<Uint8Array> } };

export async function loadBunEmbeddedWasm(): Promise<Uint8Array> {
  const mod = await import(
    // @ts-expect-error — Bun-only import attribute, resolved at compile time
    "../../wasm/tree-sitter-python.wasm",
    { with: { type: "file" } }
  );
  const wasmPath: string = mod.default ?? mod;
  return await Bun.file(wasmPath).bytes();
}

export async function loadBunEmbeddedWebTreeSitterRuntimeWasm(): Promise<Uint8Array> {
  // Resolves at compile time to the .wasm shipped by the web-tree-sitter npm
  // package. Bun bundles it into the binary; at runtime we read the embedded
  // bytes via Bun.file().bytes() and hand them to Parser.init({ wasmBinary }).
  const mod = await import(
    // @ts-expect-error — Bun-only import attribute, resolved at compile time
    "web-tree-sitter/web-tree-sitter.wasm",
    { with: { type: "file" } }
  );
  const wasmPath: string = mod.default ?? mod;
  return await Bun.file(wasmPath).bytes();
}
