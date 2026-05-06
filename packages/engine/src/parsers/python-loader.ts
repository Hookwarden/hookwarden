// Caller-supplied init for the tree-sitter-python WASM runtime.
// D-01 engine purity: this module never opens the .wasm file. The CLI runner reads
// it from disk (or fetch in a future browser playground build) and passes the bytes.

import { Language, Parser } from "web-tree-sitter";

export interface PythonRuntime {
  readonly parser: Parser;
}

export interface InitPythonRuntimeInput {
  // The raw bytes of tree-sitter-python.wasm. Caller is responsible for sourcing them.
  readonly wasmBytes: Uint8Array;
  // Optional raw bytes of web-tree-sitter.wasm — the tree-sitter runtime itself.
  // When supplied, Parser.init is called with `{ wasmBinary }`, which preempts
  // the emscripten loader's filesystem-based locateFile lookup. Required for Bun
  // --compile binaries where /$bunfs/ is virtual and the loader can't find its
  // own runtime .wasm on disk. Phase 4.2 DC-13 sibling fix.
  // Omit for Node + npm consumers — emscripten's default lookup via __dirname
  // resolves correctly under the standard install layout.
  readonly treeSitterRuntimeWasmBytes?: Uint8Array;
}

let parserInited = false;

export async function initPythonRuntime(input: InitPythonRuntimeInput): Promise<PythonRuntime> {
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
