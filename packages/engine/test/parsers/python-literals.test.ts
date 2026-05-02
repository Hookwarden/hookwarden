import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { initPythonRuntime, type PythonRuntime } from "../../src/parsers/python-loader.js";
import { parsePython } from "../../src/parsers/python.js";
import { extractPythonLiterals } from "../../src/parsers/python-literals.js";

let runtime: PythonRuntime;

beforeAll(async () => {
  const wasmPath = join(
    process.cwd(),
    "..",
    "..",
    "node_modules",
    ".pnpm",
    "tree-sitter-python@0.25.0",
    "node_modules",
    "tree-sitter-python",
    "tree-sitter-python.wasm",
  );
  const wasmBytes = readFileSync(wasmPath);
  runtime = await initPythonRuntime({ wasmBytes: new Uint8Array(wasmBytes) });
}, 30_000);

async function literalsFor(source_text: string) {
  const file = await parsePython({ file_path: "x.py", source_text }, runtime);
  return extractPythonLiterals(file.raw_ast as Parameters<typeof extractPythonLiterals>[0]);
}

describe("extractPythonLiterals", () => {
  it("captures string and number literals", async () => {
    const literals = await literalsFor(`
s = "hello"
n = 42
f = 3.14
`);
    const kinds = literals.map((l) => l.kind);
    expect(kinds).toContain("string");
    expect(kinds).toContain("number");
    expect(literals.find((l) => l.value === "hello")).toBeDefined();
    expect(literals.find((l) => l.value === "42")).toBeDefined();
    expect(literals.find((l) => l.value === "3.14")).toBeDefined();
  });

  it("treats f-strings as template literals", async () => {
    const literals = await literalsFor(`
name = "world"
greeting = f"hello, {name}"
`);
    const template = literals.find((l) => l.kind === "template");
    expect(template).toBeDefined();
  });

  it("strips bytes/raw prefixes when reading inner string value", async () => {
    const literals = await literalsFor(`
a = b"raw bytes"
b = r"\\n no escape"
`);
    const values = literals.filter((l) => l.kind === "string").map((l) => l.value);
    expect(values).toContain("raw bytes");
  });

  it("returns empty array on null tree (parse-error file)", () => {
    expect(extractPythonLiterals(null)).toEqual([]);
  });

  it("returns spans in ascending start order", async () => {
    const literals = await literalsFor(`a = "first"\nb = "second"\nc = "third"\n`);
    for (let i = 1; i < literals.length; i++) {
      const prev = literals[i - 1]!;
      const cur = literals[i]!;
      expect(cur.start).toBeGreaterThanOrEqual(prev.start);
    }
  });
});
