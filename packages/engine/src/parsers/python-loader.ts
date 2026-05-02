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
}

let parserInited = false;

export async function initPythonRuntime(input: InitPythonRuntimeInput): Promise<PythonRuntime> {
  if (!parserInited) {
    await Parser.init();
    parserInited = true;
  }
  const language = await Language.load(input.wasmBytes);
  const parser = new Parser();
  parser.setLanguage(language);
  return { parser };
}
