// Caller-supplied init for the tree-sitter-go WASM runtime.
// D-01 engine purity: this module never opens the .wasm file. The CLI runner reads
// it from disk (or fetch in a future browser playground build) and passes the bytes.
// D-10: Go parser stack mirrors the Python/PHP stacks 1:1 in API shape so the CLI
// runner can switch on dialect uniformly.
// D-13: tree-sitter-go@0.25.0 (pinned in packages/engine/package.json devDeps; bytes
// sourced via packages/cli/scripts/sync-wasm.mjs into packages/cli/wasm/).

import { Language, Parser } from "web-tree-sitter";

export interface GoRuntime {
  readonly parser: Parser;
}

export interface InitGoRuntimeInput {
  // The raw bytes of tree-sitter-go.wasm. Caller is responsible for sourcing them.
  readonly wasmBytes: Uint8Array;
  // Optional raw bytes of web-tree-sitter.wasm — the tree-sitter runtime itself.
  // When supplied, Parser.init is called with `{ wasmBinary }`, which preempts
  // the emscripten loader's filesystem-based locateFile lookup. Required for Bun
  // --compile binaries where /$bunfs/ is virtual and the loader can't find its
  // own runtime .wasm on disk. Phase 4.2 DC-13 sibling fix (Success Criterion #4).
  // Omit for Node + npm consumers — emscripten's default lookup via __dirname
  // resolves correctly under the standard install layout.
  readonly treeSitterRuntimeWasmBytes?: Uint8Array;
}

// Module-scoped flag. web-tree-sitter's Parser.init() is idempotent across multiple calls,
// so a separate flag from Python/PHP's is safe — each call just guards its respective
// module's "did we init yet" state without coordination.
let parserInited = false;

export async function initGoRuntime(input: InitGoRuntimeInput): Promise<GoRuntime> {
  if (!parserInited) {
    if (input.treeSitterRuntimeWasmBytes !== undefined) {
      await Parser.init({ wasmBinary: input.treeSitterRuntimeWasmBytes });
    } else {
      await Parser.init();
    }
    parserInited = true;
  }
  const language = await Language.load(input.wasmBytes);
  const parser = new Parser();
  parser.setLanguage(language);
  return { parser };
}
