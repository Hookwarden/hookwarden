// Phase 8.2 Plan 04 Task 1: Python rewriter tests.

import { beforeAll, describe, expect, it } from "vitest";
import { initPythonRuntime, parsePython, type PythonRuntime } from "@hookwarden/engine";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { FixEdit } from "../../src/index.js";
import { buildForbiddenRanges } from "../../src/forbidden-ranges.js";
import { rewritePython } from "../../src/python/rewriter.js";

const CLI_WASM_DIR = path.resolve(__dirname, "../../../cli/wasm");
let pythonRuntime: PythonRuntime;

beforeAll(async () => {
  const bytes = await fs.readFile(path.join(CLI_WASM_DIR, "tree-sitter-python.wasm"));
  pythonRuntime = await initPythonRuntime({ wasmBytes: bytes });
}, 30_000);

function mkEdit(overrides: Partial<FixEdit> & Pick<FixEdit, "startByte" | "endByte" | "after">): FixEdit {
  return {
    ruleId: "test/rule",
    routineId: "test-routine",
    filePath: "x.py",
    start: { line: 1, col: 1 },
    end: { line: 1, col: 1 },
    before: "",
    safety: "safe",
    ...overrides,
  };
}

describe("rewritePython — positive cases", () => {
  it("applies one valid edit", async () => {
    const src = "if a == b:\n    pass\n";
    const parsed = await parsePython({ file_path: "x.py", source_text: src }, pythonRuntime);
    const mask = buildForbiddenRanges(parsed);
    const start = src.indexOf("a == b");
    const result = rewritePython({
      parsedFile: parsed,
      edits: [
        mkEdit({
          startByte: start,
          endByte: start + "a == b".length,
          before: "a == b",
          after: "hmac.compare_digest(a, b)",
        }),
      ],
      forbiddenRanges: mask,
    });
    expect(result.applied).toHaveLength(1);
    expect(result.newSource).toContain("hmac.compare_digest(a, b)");
  });

  it("returns newSource === input when edits is empty", async () => {
    const src = "x = 1\n";
    const parsed = await parsePython({ file_path: "x.py", source_text: src }, pythonRuntime);
    const mask = buildForbiddenRanges(parsed);
    const result = rewritePython({ parsedFile: parsed, edits: [], forbiddenRanges: mask });
    expect(result.newSource).toBe(src);
  });
});

describe("rewritePython — negative cases", () => {
  it("rejects edit inside a triple-quoted docstring", async () => {
    const src = 'def f():\n    """if a == b: True"""\n    return 0\n';
    const parsed = await parsePython({ file_path: "x.py", source_text: src }, pythonRuntime);
    const mask = buildForbiddenRanges(parsed);
    const start = src.indexOf("a == b");
    const result = rewritePython({
      parsedFile: parsed,
      edits: [
        mkEdit({
          startByte: start,
          endByte: start + "a == b".length,
          before: "a == b",
          after: "hmac.compare_digest(a, b)",
        }),
      ],
      forbiddenRanges: mask,
    });
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe("forbidden-range");
  });

  it("rejects edit inside a # comment", async () => {
    const src = "x = 1  # a == b is a comment\n";
    const parsed = await parsePython({ file_path: "x.py", source_text: src }, pythonRuntime);
    const mask = buildForbiddenRanges(parsed);
    const start = src.indexOf("a == b");
    const result = rewritePython({
      parsedFile: parsed,
      edits: [
        mkEdit({
          startByte: start,
          endByte: start + "a == b".length,
          before: "a == b",
          after: "hmac.compare_digest(a, b)",
        }),
      ],
      forbiddenRanges: mask,
    });
    expect(result.rejected[0]?.reason).toBe("forbidden-range");
  });

  it("rejects multi-line edit (D-07)", async () => {
    const src = "x = (\n  a\n)\n";
    const parsed = await parsePython({ file_path: "x.py", source_text: src }, pythonRuntime);
    const mask = buildForbiddenRanges(parsed);
    const result = rewritePython({
      parsedFile: parsed,
      edits: [
        mkEdit({
          startByte: 0,
          endByte: src.length - 1,
          before: src.slice(0, -1),
          after: "x = a",
        }),
      ],
      forbiddenRanges: mask,
    });
    expect(result.rejected[0]?.reason).toBe("multi-line");
  });

  it("rejects out-of-bounds edit", async () => {
    const src = "x = 1\n";
    const parsed = await parsePython({ file_path: "x.py", source_text: src }, pythonRuntime);
    const mask = buildForbiddenRanges(parsed);
    const result = rewritePython({
      parsedFile: parsed,
      edits: [mkEdit({ startByte: 0, endByte: 9999, before: "", after: "" })],
      forbiddenRanges: mask,
    });
    expect(result.rejected[0]?.reason).toBe("out-of-bounds");
  });
});

describe("rewritePython — pre-condition violations", () => {
  it("throws TypeError when dialect is not tree-sitter-python", async () => {
    const src = "x = 1\n";
    const parsed = await parsePython({ file_path: "x.py", source_text: src }, pythonRuntime);
    const fake = { ...parsed, dialect: "babel" as const };
    expect(() =>
      rewritePython({ parsedFile: fake, edits: [], forbiddenRanges: [] }),
    ).toThrow(TypeError);
  });

  it("throws when parse_error is non-null", async () => {
    const src = "def )(:\n"; // invalid syntax
    const parsed = await parsePython({ file_path: "x.py", source_text: src }, pythonRuntime);
    expect(parsed.parse_error).not.toBeNull();
    expect(() =>
      rewritePython({ parsedFile: parsed, edits: [], forbiddenRanges: [] }),
    ).toThrow(/refusing to rewrite.*parse error/);
  });
});
