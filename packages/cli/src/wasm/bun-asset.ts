// Bun-only asset import for tree-sitter-python.wasm.
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
