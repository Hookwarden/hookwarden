// Phase 27 (FIX-GO-01) — Go rewriter tests. Includes the mandatory forbidden-range refusal
// negative tests (MEMORY feedback_negative_tests_required): the fixer NEVER edits inside a
// comment / interpreted_string_literal / raw_string_literal / rune_literal.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { type GoRuntime, initGoRuntime, parseGo } from "@hookwarden/engine";
import { beforeAll, describe, expect, it } from "vitest";
import { buildForbiddenRanges } from "../../src/forbidden-ranges.js";
import { rewriteGo } from "../../src/go/rewriter.js";
import type { FixEdit } from "../../src/index.js";

const CLI_WASM_DIR = path.resolve(__dirname, "../../../cli/wasm");
let goRuntime: GoRuntime;

beforeAll(async () => {
  const bytes = await fs.readFile(path.join(CLI_WASM_DIR, "tree-sitter-go.wasm"));
  goRuntime = await initGoRuntime({ wasmBytes: bytes });
}, 30_000);

function mkEdit(
  overrides: Partial<FixEdit> & Pick<FixEdit, "startByte" | "endByte" | "after">,
): FixEdit {
  return {
    ruleId: "test/rule",
    routineId: "test-routine",
    filePath: "x.go",
    start: { line: 1, col: 1 },
    end: { line: 1, col: 1 },
    before: "",
    safety: "safe",
    ...overrides,
  };
}

const parse = (src: string) => parseGo({ file_path: "x.go", source_text: src }, goRuntime);

describe("rewriteGo — positive cases", () => {
  it("applies one valid edit (bytes.Equal → hmac.Equal)", async () => {
    const src = "package x\nfunc f() bool { return bytes.Equal(mac, sig) }\n";
    const parsed = await parse(src);
    const mask = buildForbiddenRanges(parsed);
    const target = "bytes.Equal(mac, sig)";
    const start = src.indexOf(target);
    const result = rewriteGo({
      parsedFile: parsed,
      edits: [
        mkEdit({
          startByte: start,
          endByte: start + target.length,
          before: target,
          after: "hmac.Equal(mac, sig)",
        }),
      ],
      forbiddenRanges: mask,
    });
    expect(result.applied).toHaveLength(1);
    expect(result.newSource).toContain("hmac.Equal(mac, sig)");
  });

  it("returns newSource === input when edits is empty", async () => {
    const src = "package x\nvar y = 1\n";
    const parsed = await parse(src);
    const result = rewriteGo({
      parsedFile: parsed,
      edits: [],
      forbiddenRanges: buildForbiddenRanges(parsed),
    });
    expect(result.newSource).toBe(src);
  });
});

describe("rewriteGo — forbidden-range refusals (mandatory negative tests)", () => {
  async function expectRefused(src: string, needle: string): Promise<void> {
    const parsed = await parse(src);
    const mask = buildForbiddenRanges(parsed);
    const start = src.indexOf(needle);
    expect(start).toBeGreaterThan(0);
    const result = rewriteGo({
      parsedFile: parsed,
      edits: [
        mkEdit({
          startByte: start,
          endByte: start + needle.length,
          before: needle,
          after: "REPLACED",
        }),
      ],
      forbiddenRanges: mask,
    });
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe("forbidden-range");
    expect(result.newSource).toBe(src);
  }

  it("refuses an edit inside a // line comment", async () => {
    await expectRefused(
      "package x\n// bytes.Equal(mac, sig) is the bug\nvar y = 1\n",
      "bytes.Equal(mac, sig)",
    );
  });

  it("refuses an edit inside a raw_string_literal (backtick)", async () => {
    await expectRefused("package x\nvar s = `bytes.Equal(mac, sig)`\n", "bytes.Equal(mac, sig)");
  });

  it("refuses an edit inside an interpreted_string_literal", async () => {
    await expectRefused('package x\nvar s = "bytes.Equal(mac, sig)"\n', "bytes.Equal(mac, sig)");
  });

  it("rejects a multi-line edit", async () => {
    const src = "package x\nvar y =\n1\n";
    const parsed = await parse(src);
    const result = rewriteGo({
      parsedFile: parsed,
      edits: [
        mkEdit({
          startByte: 13,
          endByte: src.length - 1,
          before: src.slice(13, -1),
          after: "y = 1",
        }),
      ],
      forbiddenRanges: buildForbiddenRanges(parsed),
    });
    expect(result.rejected[0]?.reason).toBe("multi-line");
  });
});

describe("rewriteGo — pre-condition violations", () => {
  it("throws TypeError when dialect is not tree-sitter-go", async () => {
    const parsed = await parse("package x\nvar y = 1\n");
    const fake = { ...parsed, dialect: "babel" as const };
    expect(() => rewriteGo({ parsedFile: fake, edits: [], forbiddenRanges: [] })).toThrow(
      TypeError,
    );
  });

  it("throws when parse_error is non-null", async () => {
    const parsed = await parse("package x\nvar y = 1\n");
    const forced = {
      ...parsed,
      parse_error: {
        message: "forced",
        location: { line: 1, col: 1 },
        source: "tree-sitter" as const,
      },
    };
    expect(() => rewriteGo({ parsedFile: forced, edits: [], forbiddenRanges: [] })).toThrow(
      /refusing to rewrite.*parse error/,
    );
  });
});
