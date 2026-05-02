import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { initPythonRuntime, type PythonRuntime } from "../../src/parsers/python-loader.js";
import { parsePython } from "../../src/parsers/python.js";

let runtime: PythonRuntime;

beforeAll(async () => {
  // Test-only fs read — engine src/ stays pure (test files are outside the purity gate).
  // pnpm content-addressed install location — verified via `find node_modules/.pnpm`.
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

describe("parsePython — happy path", () => {
  it("parses a simple Python file and returns dialect: 'tree-sitter-python'", async () => {
    const result = await parsePython(
      { file_path: "app.py", source_text: "def f(x):\n    return x + 1\n" },
      runtime,
    );
    expect(result.dialect).toBe("tree-sitter-python");
    expect(result.language).toBe("python");
    expect(result.parse_error).toBeNull();
    expect(result.raw_ast).not.toBeNull();
  });

  it("captures `import x`, `import x as y`, `from a import b`, `from a import b as c`", async () => {
    const result = await parsePython(
      {
        file_path: "imports.py",
        source_text:
          "import flask\n" +
          "import stripe as s\n" +
          "from fastapi import APIRouter\n" +
          "from hmac import compare_digest as cd\n",
      },
      runtime,
    );
    expect(result.parse_error).toBeNull();
    const modules = result.imports.map((i) => i.to_module).sort();
    expect(modules).toEqual(["fastapi", "flask", "hmac", "stripe"]);

    const stripe = result.imports.find((i) => i.to_module === "stripe");
    expect(stripe?.imported_names[0]?.local).toBe("s");

    const hmac = result.imports.find((i) => i.to_module === "hmac");
    expect(hmac?.imported_names[0]).toEqual({ local: "cd", source: "compare_digest" });
  });
});

describe("parsePython — D-27 all-or-nothing parse error (ENGINE-07, PITFALLS #6)", () => {
  it("returns ParseErrorRecord with source: 'tree-sitter' on syntax error", async () => {
    // Use a broken-but-not-recoverable syntax: unclosed parens with following statements
    // tree-sitter-python recovers from many minor errors; this pattern reliably leaves an ERROR node.
    const result = await parsePython(
      { file_path: "broken.py", source_text: "def f(x, :\n    return\nclass !!:\n    pass\n" },
      runtime,
    );
    expect(result.parse_error).not.toBeNull();
    expect(result.parse_error?.source).toBe("tree-sitter");
    expect(result.imports).toEqual([]);
    expect(result.raw_ast).toBeNull();
  });

  it("returns ParseErrorRecord on garbage content", async () => {
    const result = await parsePython(
      { file_path: "garbage.py", source_text: "@@@!!!---" },
      runtime,
    );
    expect(result.parse_error).not.toBeNull();
  });
});

describe("parsePython — modern syntax coverage probe (PITFALLS #6 surface)", () => {
  it("simple decorator parses cleanly", async () => {
    const result = await parsePython(
      {
        file_path: "deco.py",
        source_text:
          "from functools import wraps\n\n" +
          "def auth(fn):\n" +
          "    @wraps(fn)\n" +
          "    def inner(*args, **kw):\n" +
          "        return fn(*args, **kw)\n" +
          "    return inner\n",
      },
      runtime,
    );
    expect(result.parse_error).toBeNull();
  });

  it("FastAPI-style decorator on async function parses cleanly", async () => {
    const result = await parsePython(
      {
        file_path: "fastapi_app.py",
        source_text:
          "from fastapi import APIRouter\n" +
          "router = APIRouter()\n\n" +
          "@router.post('/webhooks/stripe')\n" +
          "async def stripe_webhook(req):\n" +
          "    return {'ok': True}\n",
      },
      runtime,
    );
    expect(result.parse_error).toBeNull();
  });
});
