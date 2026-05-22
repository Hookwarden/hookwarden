// Phase 8.2 Plan 04 Task 2: PHP rewriter tests.
// Includes the explicit heredoc-safety test that closes the D-08 PHP concern.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { initPhpRuntime, type PhpRuntime, parsePhp } from "@hookwarden/engine";
import { beforeAll, describe, expect, it } from "vitest";
import { buildForbiddenRanges } from "../../src/forbidden-ranges.js";
import type { FixEdit } from "../../src/index.js";
import { rewritePhp } from "../../src/php/rewriter.js";

const CLI_WASM_DIR = path.resolve(__dirname, "../../../cli/wasm");
let phpRuntime: PhpRuntime;

beforeAll(async () => {
  const bytes = await fs.readFile(path.join(CLI_WASM_DIR, "tree-sitter-php.wasm"));
  phpRuntime = await initPhpRuntime({ wasmBytes: bytes });
}, 30_000);

function mkEdit(
  overrides: Partial<FixEdit> & Pick<FixEdit, "startByte" | "endByte" | "after">,
): FixEdit {
  return {
    ruleId: "test/rule",
    routineId: "test-routine",
    filePath: "x.php",
    start: { line: 1, col: 1 },
    end: { line: 1, col: 1 },
    before: "",
    safety: "safe",
    ...overrides,
  };
}

describe("rewritePhp — positive cases", () => {
  it("applies one valid edit (strcmp → hash_equals)", async () => {
    const src = "<?php\nif (strcmp($a, $b) === 0) { return true; }\n";
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    const mask = buildForbiddenRanges(parsed);
    const target = "strcmp($a, $b) === 0";
    const start = src.indexOf(target);
    const result = rewritePhp({
      parsedFile: parsed,
      edits: [
        mkEdit({
          startByte: start,
          endByte: start + target.length,
          before: target,
          after: "hash_equals($a, $b)",
        }),
      ],
      forbiddenRanges: mask,
    });
    expect(result.applied).toHaveLength(1);
    expect(result.newSource).toContain("hash_equals($a, $b)");
  });

  it("returns newSource === input when edits is empty", async () => {
    const src = "<?php\n$x = 1;\n";
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    const mask = buildForbiddenRanges(parsed);
    const result = rewritePhp({ parsedFile: parsed, edits: [], forbiddenRanges: mask });
    expect(result.newSource).toBe(src);
  });
});

describe("rewritePhp — negative cases (D-08 PHP safety)", () => {
  it("refuses to touch code embedded in a heredoc", async () => {
    const src = "<?php\n$snippet = <<<EOT\nif (\\$a == \\$b) {\n    return true;\n}\nEOT;\n";
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    const mask = buildForbiddenRanges(parsed);
    const target = "\\$a == \\$b";
    const start = src.indexOf(target);
    expect(start).toBeGreaterThan(0);
    const result = rewritePhp({
      parsedFile: parsed,
      edits: [
        mkEdit({
          startByte: start,
          endByte: start + target.length,
          before: target,
          after: "hash_equals(\\$a, \\$b)",
        }),
      ],
      forbiddenRanges: mask,
    });
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe("forbidden-range");
    expect(result.newSource).toBe(src);
  });

  it("rejects edit inside a nowdoc body", async () => {
    const src = "<?php\n$x = <<<'EOT'\nif ($a == $b) {}\nEOT;\n";
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    const mask = buildForbiddenRanges(parsed);
    const start = src.indexOf("$a == $b");
    const result = rewritePhp({
      parsedFile: parsed,
      edits: [
        mkEdit({
          startByte: start,
          endByte: start + "$a == $b".length,
          before: "$a == $b",
          after: "hash_equals($a, $b)",
        }),
      ],
      forbiddenRanges: mask,
    });
    expect(result.rejected[0]?.reason).toBe("forbidden-range");
  });

  it("rejects edit inside a // line comment", async () => {
    const src = "<?php\n// $a == $b is a comment\n";
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    const mask = buildForbiddenRanges(parsed);
    const start = src.indexOf("$a == $b");
    const result = rewritePhp({
      parsedFile: parsed,
      edits: [
        mkEdit({
          startByte: start,
          endByte: start + "$a == $b".length,
          before: "$a == $b",
          after: "hash_equals($a, $b)",
        }),
      ],
      forbiddenRanges: mask,
    });
    expect(result.rejected[0]?.reason).toBe("forbidden-range");
  });

  it("rejects edit inside a /* */ block comment", async () => {
    const src = "<?php\n/* $a == $b */\n$x = 1;\n";
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    const mask = buildForbiddenRanges(parsed);
    const start = src.indexOf("$a == $b");
    const result = rewritePhp({
      parsedFile: parsed,
      edits: [
        mkEdit({
          startByte: start,
          endByte: start + "$a == $b".length,
          before: "$a == $b",
          after: "hash_equals($a, $b)",
        }),
      ],
      forbiddenRanges: mask,
    });
    expect(result.rejected[0]?.reason).toBe("forbidden-range");
  });

  it("rejects edit inside an encapsed_string (double-quoted with interpolation)", async () => {
    const src = '<?php\n$msg = "value is $a == $b";\n';
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    const mask = buildForbiddenRanges(parsed);
    const start = src.indexOf("$a == $b");
    const result = rewritePhp({
      parsedFile: parsed,
      edits: [
        mkEdit({
          startByte: start,
          endByte: start + "$a == $b".length,
          before: "$a == $b",
          after: "hash_equals($a, $b)",
        }),
      ],
      forbiddenRanges: mask,
    });
    expect(result.rejected[0]?.reason).toBe("forbidden-range");
  });

  it("rejects multi-line edit (D-07)", async () => {
    const src = "<?php\n$x =\n1;\n";
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    const mask = buildForbiddenRanges(parsed);
    const result = rewritePhp({
      parsedFile: parsed,
      edits: [
        mkEdit({
          startByte: 6,
          endByte: src.length - 1,
          before: src.slice(6, -1),
          after: "$x = 1;",
        }),
      ],
      forbiddenRanges: mask,
    });
    expect(result.rejected[0]?.reason).toBe("multi-line");
  });
});

describe("rewritePhp — pre-condition violations", () => {
  it("throws TypeError when dialect is not tree-sitter-php", async () => {
    const src = "<?php\n$x = 1;\n";
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    const fake = { ...parsed, dialect: "babel" as const };
    expect(() => rewritePhp({ parsedFile: fake, edits: [], forbiddenRanges: [] })).toThrow(
      TypeError,
    );
  });

  it("throws when parse_error is non-null", async () => {
    const src = "<?php\nfunction (\n"; // invalid syntax
    const parsed = await parsePhp({ file_path: "x.php", source_text: src }, phpRuntime);
    if (parsed.parse_error === null) {
      // Some PHP parser builds tolerate this; force a parse_error to exercise the gate.
      const forced = {
        ...parsed,
        parse_error: {
          message: "forced parse error for test",
          location: { line: 1, col: 1 },
          source: "tree-sitter" as const,
        },
      };
      expect(() => rewritePhp({ parsedFile: forced, edits: [], forbiddenRanges: [] })).toThrow(
        /refusing to rewrite.*parse error/,
      );
      return;
    }
    expect(() => rewritePhp({ parsedFile: parsed, edits: [], forbiddenRanges: [] })).toThrow(
      /refusing to rewrite.*parse error/,
    );
  });
});
