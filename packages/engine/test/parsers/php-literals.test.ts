import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { parsePhp } from "../../src/parsers/php.js";
import { extractPhpLiterals } from "../../src/parsers/php-literals.js";
import { initPhpRuntime, type PhpRuntime } from "../../src/parsers/php-loader.js";
import { resolvePhpWasmPath } from "../wasm.js";

let runtime: PhpRuntime;

beforeAll(async () => {
  const wasmBytes = readFileSync(resolvePhpWasmPath());
  runtime = await initPhpRuntime({ wasmBytes: new Uint8Array(wasmBytes) });
}, 30_000);

async function literalsFor(sourceText: string) {
  const file = await parsePhp({ file_path: "x.php", source_text: sourceText }, runtime);
  return extractPhpLiterals(file.raw_ast as Parameters<typeof extractPhpLiterals>[0]);
}

describe("extractPhpLiterals", () => {
  it("captures single-quoted string and number literals", async () => {
    const literals = await literalsFor("<?php\n$s = 'hello';\n$n = 42;\n$f = 3.14;\n");
    const kinds = literals.map((l) => l.kind);
    expect(kinds).toContain("string");
    expect(kinds).toContain("number");
    expect(literals.find((l) => l.value === "hello")).toBeDefined();
    expect(literals.find((l) => l.value === "42")).toBeDefined();
    expect(literals.find((l) => l.value === "3.14")).toBeDefined();
  });

  it("treats double-quoted strings with $-interpolation as template literals", async () => {
    const literals = await literalsFor("<?php\n$name = 'world';\n$greeting = \"hello, $name\";\n");
    const templates = literals.filter((l) => l.kind === "template");
    expect(templates.length).toBeGreaterThanOrEqual(1);
    expect(templates[0]?.value).toBe("<TEMPLATE>");
  });

  it("treats double-quoted strings WITHOUT interpolation as plain string", async () => {
    const literals = await literalsFor('<?php\n$s = "no vars here";\n');
    // The encapsed_string is the outer node; we should produce a string with the inner value.
    const stringLiterals = literals.filter((l) => l.kind === "string");
    expect(stringLiterals.find((l) => l.value === "no vars here")).toBeDefined();
  });

  it("treats nowdoc bodies as plain string (never interpolates, single-quoted opener)", async () => {
    // Nowdoc: <<<'EOT' ... EOT;
    const literals = await literalsFor("<?php\n$s = <<<'EOT'\n$name stays raw\nEOT;\n");
    const templates = literals.filter((l) => l.kind === "template");
    expect(templates).toHaveLength(0);
    const strings = literals.filter((l) => l.kind === "string");
    expect(strings.find((l) => l.value.includes("$name stays raw"))).toBeDefined();
  });

  it("treats heredoc bodies with $-interpolation as template literals", async () => {
    // Heredoc: <<<EOT ... EOT; (double-quoted opener, interpolates)
    const literals = await literalsFor("<?php\n$x = 'world';\n$s = <<<EOT\nhello $x\nEOT;\n");
    const templates = literals.filter((l) => l.kind === "template");
    expect(templates.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty array on null tree (parse-error file)", () => {
    expect(extractPhpLiterals(null)).toEqual([]);
  });

  it("returns spans in ascending start order", async () => {
    const literals = await literalsFor("<?php\n$a = 'first';\n$b = 'second';\n$c = 'third';\n");
    for (let i = 1; i < literals.length; i++) {
      const prev = literals[i - 1]!;
      const cur = literals[i]!;
      expect(cur.start).toBeGreaterThanOrEqual(prev.start);
    }
  });
});
