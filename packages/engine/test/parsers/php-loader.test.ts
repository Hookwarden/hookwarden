import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { initPhpRuntime, type PhpRuntime } from "../../src/parsers/php-loader.js";
import { resolvePhpWasmPath } from "../wasm.js";

let runtime: PhpRuntime;

beforeAll(async () => {
  const wasmBytes = readFileSync(resolvePhpWasmPath());
  runtime = await initPhpRuntime({ wasmBytes: new Uint8Array(wasmBytes) });
}, 30_000);

describe("initPhpRuntime", () => {
  it("returns a runtime that parses a 1-line PHP file to a root `program` node", () => {
    const tree = runtime.parser.parse("<?php echo 'hi';");
    expect(tree).not.toBeNull();
    expect(tree?.rootNode.type).toBe("program");
  });

  it("is idempotent — calling initPhpRuntime twice yields independent parser instances", async () => {
    const wasmBytes = readFileSync(resolvePhpWasmPath());
    const second = await initPhpRuntime({ wasmBytes: new Uint8Array(wasmBytes) });
    expect(second.parser).not.toBe(runtime.parser);
    const tree = second.parser.parse("<?php $a = 1;");
    expect(tree?.rootNode.type).toBe("program");
  });
});
