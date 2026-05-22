// Phase 8.2 Plan 03 Task 1: forbidden-ranges mask + intersects primitive.
//
// Per [[feedback_negative_tests_required]] — negative tests prove the mask
// does NOT swallow safe-to-rewrite ranges (plain strings, regular code).

import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  initPhpRuntime,
  initPythonRuntime,
  type PhpRuntime,
  type PythonRuntime,
  parseJsTs,
  parsePhp,
  parsePython,
} from "@hookwarden/engine";
import { beforeAll, describe, expect, it } from "vitest";
import { buildForbiddenRanges, type ForbiddenRange, intersects } from "../src/forbidden-ranges.js";

const CLI_WASM_DIR = path.resolve(__dirname, "../../cli/wasm");

let pythonRuntime: PythonRuntime;
let phpRuntime: PhpRuntime;

beforeAll(async () => {
  const pyBytes = await fs.readFile(path.join(CLI_WASM_DIR, "tree-sitter-python.wasm"));
  const phpBytes = await fs.readFile(path.join(CLI_WASM_DIR, "tree-sitter-php.wasm"));
  pythonRuntime = await initPythonRuntime({ wasmBytes: pyBytes });
  phpRuntime = await initPhpRuntime({ wasmBytes: phpBytes });
}, 30_000);

describe("buildForbiddenRanges — JS/TS (babel)", () => {
  it("masks template literals", async () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture is a literal JS template-literal source string
    const src = "const x = `hello ${name}`;\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const mask = buildForbiddenRanges(parsed);
    const tl = mask.find((r) => r.kind === "template-literal");
    expect(tl).toBeDefined();
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the fixture's template-literal text appears verbatim
    expect(src.slice(tl?.start, tl?.end)).toBe("`hello ${name}`");
  });

  it("masks line comments", async () => {
    const src = "const x = 1; // line comment here\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const mask = buildForbiddenRanges(parsed);
    const comment = mask.find(
      (r) => r.kind === "comment" && src.slice(r.start, r.end).includes("line comment"),
    );
    expect(comment).toBeDefined();
  });

  it("masks block comments", async () => {
    const src = "/* block comment */ const x = 1;\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const mask = buildForbiddenRanges(parsed);
    const blockComment = mask.find(
      (r) => r.kind === "comment" && src.slice(r.start, r.end).startsWith("/*"),
    );
    expect(blockComment).toBeDefined();
  });

  it("does NOT mask plain string literals (negative — byte-stable, safe for rewrites)", async () => {
    const src = 'const x = "hello world";\n';
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const mask = buildForbiddenRanges(parsed);
    const stringStart = src.indexOf('"hello');
    const stringEnd = stringStart + '"hello world"'.length;
    // Assert no range contains the plain string's bytes.
    expect(mask.some((r) => r.start <= stringStart && stringEnd <= r.end)).toBe(false);
  });

  it("does NOT mask ordinary code (negative — empty mask for code-only source)", async () => {
    const src = "const x = 1 + 2; const y = x * 3;\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const mask = buildForbiddenRanges(parsed);
    expect(mask).toHaveLength(0);
  });
});

describe("buildForbiddenRanges — Python (tree-sitter-python)", () => {
  it("masks triple-quoted strings", async () => {
    const src = 'def f():\n    """docstring"""\n    return 1\n';
    const parsed = await parsePython({ file_path: "f.py", source_text: src }, pythonRuntime);
    const mask = buildForbiddenRanges(parsed);
    const triple = mask.find((r) => r.kind === "triple-quoted");
    expect(triple).toBeDefined();
    expect(src.slice(triple?.start, triple?.end)).toBe('"""docstring"""');
  });

  it("masks # comments", async () => {
    const src = "x = 1  # this is a comment\n";
    const parsed = await parsePython({ file_path: "f.py", source_text: src }, pythonRuntime);
    const mask = buildForbiddenRanges(parsed);
    const comment = mask.find((r) => r.kind === "comment");
    expect(comment).toBeDefined();
    expect(src.slice(comment?.start, comment?.end)).toBe("# this is a comment");
  });

  it("does NOT mask single-line strings (negative — only triple-quoted per D-08)", async () => {
    const src = "x = \"hello\"\ny = 'world'\n";
    const parsed = await parsePython({ file_path: "f.py", source_text: src }, pythonRuntime);
    const mask = buildForbiddenRanges(parsed);
    expect(mask.filter((r) => r.kind === "triple-quoted")).toHaveLength(0);
  });
});

describe("buildForbiddenRanges — PHP (tree-sitter-php)", () => {
  it("masks heredocs", async () => {
    const src = "<?php\n$x = <<<EOT\nhello\nEOT;\n";
    const parsed = await parsePhp({ file_path: "f.php", source_text: src }, phpRuntime);
    const mask = buildForbiddenRanges(parsed);
    const heredoc = mask.find((r) => r.kind === "heredoc");
    expect(heredoc).toBeDefined();
  });

  it("masks nowdocs", async () => {
    const src = "<?php\n$x = <<<'EOT'\nliteral\nEOT;\n";
    const parsed = await parsePhp({ file_path: "f.php", source_text: src }, phpRuntime);
    const mask = buildForbiddenRanges(parsed);
    const nowdoc = mask.find((r) => r.kind === "nowdoc");
    expect(nowdoc).toBeDefined();
  });

  it("masks encapsed (double-quoted with interpolation)", async () => {
    const src = '<?php\n$name = "world";\n$x = "hello $name";\n';
    const parsed = await parsePhp({ file_path: "f.php", source_text: src }, phpRuntime);
    const mask = buildForbiddenRanges(parsed);
    const encapsed = mask.find((r) => r.kind === "encapsed-string");
    expect(encapsed).toBeDefined();
  });

  it("masks comments (//, /* */, #)", async () => {
    const src = "<?php\n// line\n/* block */\n# hash\n$x = 1;\n";
    const parsed = await parsePhp({ file_path: "f.php", source_text: src }, phpRuntime);
    const mask = buildForbiddenRanges(parsed);
    const comments = mask.filter((r) => r.kind === "comment");
    expect(comments.length).toBeGreaterThanOrEqual(3);
  });

  it("masks shell_command_expression (backtick exec)", async () => {
    const src = "<?php\n$out = `ls -la`;\n";
    const parsed = await parsePhp({ file_path: "f.php", source_text: src }, phpRuntime);
    const mask = buildForbiddenRanges(parsed);
    const shell = mask.find((r) => r.kind === "shell-command");
    expect(shell).toBeDefined();
  });

  it("does NOT mask single-quoted PHP strings (negative — byte-stable, NOT in PHP_FORBIDDEN_NODE_KINDS)", async () => {
    const src = "<?php\n$x = 'literal value';\n";
    const parsed = await parsePhp({ file_path: "f.php", source_text: src }, phpRuntime);
    const mask = buildForbiddenRanges(parsed);
    const literalStart = src.indexOf("'literal");
    const literalEnd = literalStart + "'literal value'".length;
    expect(mask.every((r) => !(r.start <= literalStart && literalEnd <= r.end))).toBe(true);
  });
});

describe("intersects() — half-open semantics", () => {
  const mask: ReadonlyArray<ForbiddenRange> = [
    { start: 10, end: 20, kind: "comment" },
    { start: 30, end: 40, kind: "template-literal" },
  ];

  it("edit fully inside a forbidden range → true", () => {
    expect(intersects({ start: 12, end: 18 }, mask)).toBe(true);
  });

  it("edit fully outside → false", () => {
    expect(intersects({ start: 21, end: 29 }, mask)).toBe(false);
  });

  it("edit overlaps the start of a forbidden range → true", () => {
    expect(intersects({ start: 5, end: 12 }, mask)).toBe(true);
  });

  it("edit overlaps the end → true", () => {
    expect(intersects({ start: 18, end: 25 }, mask)).toBe(true);
  });

  it("edit exactly adjacent (edit.end === range.start) → false (half-open)", () => {
    expect(intersects({ start: 5, end: 10 }, mask)).toBe(false);
  });

  it("edit exactly adjacent (edit.start === range.end) → false (half-open)", () => {
    expect(intersects({ start: 20, end: 25 }, mask)).toBe(false);
  });

  it("empty mask → always false", () => {
    expect(intersects({ start: 0, end: 100 }, [])).toBe(false);
  });
});
