import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { parsePhp } from "../../src/parsers/php.js";
import { initPhpRuntime, type PhpRuntime } from "../../src/parsers/php-loader.js";
import { resolvePhpWasmPath } from "../wasm.js";

let runtime: PhpRuntime;

beforeAll(async () => {
  const wasmBytes = readFileSync(resolvePhpWasmPath());
  runtime = await initPhpRuntime({ wasmBytes: new Uint8Array(wasmBytes) });
}, 30_000);

describe("parsePhp — happy path", () => {
  it("parses a simple PHP file and returns dialect: 'tree-sitter-php'", async () => {
    const result = await parsePhp(
      {
        file_path: "webhook.php",
        source_text: "<?php\nfunction handle($req) {\n  return 'ok';\n}\n",
      },
      runtime,
    );
    expect(result.dialect).toBe("tree-sitter-php");
    expect(result.language).toBe("php");
    expect(result.parse_error).toBeNull();
    expect(result.raw_ast).not.toBeNull();
  });

  it("captures `use Foo\\Bar;` as an ImportEdge with last-segment local name", async () => {
    const result = await parsePhp(
      {
        file_path: "imports.php",
        source_text:
          "<?php\nuse Stripe\\Webhook;\nuse Symfony\\Component\\HttpFoundation\\Request;\n",
      },
      runtime,
    );
    expect(result.parse_error).toBeNull();
    const modules = result.imports.map((i) => i.to_module).sort();
    expect(modules).toEqual(["Stripe\\Webhook", "Symfony\\Component\\HttpFoundation\\Request"]);

    const stripe = result.imports.find((i) => i.to_module === "Stripe\\Webhook");
    expect(stripe?.imported_names[0]).toEqual({ local: "Webhook", source: "default" });
    expect(stripe?.is_default).toBe(true);

    const symfony = result.imports.find(
      (i) => i.to_module === "Symfony\\Component\\HttpFoundation\\Request",
    );
    expect(symfony?.imported_names[0]?.local).toBe("Request");
  });

  it("captures aliased `use Foo\\Bar as Baz;` with alias as local", async () => {
    const result = await parsePhp(
      {
        file_path: "aliased.php",
        source_text: "<?php\nuse Stripe\\Webhook as StripeHook;\n",
      },
      runtime,
    );
    expect(result.parse_error).toBeNull();
    const stripe = result.imports[0];
    expect(stripe?.to_module).toBe("Stripe\\Webhook");
    expect(stripe?.imported_names[0]).toEqual({ local: "StripeHook", source: "default" });
  });

  it("expands group `use Foo\\{Bar, Baz};` into one ImportEdge per name", async () => {
    const result = await parsePhp(
      {
        file_path: "group.php",
        source_text:
          "<?php\nuse Symfony\\Component\\HttpFoundation\\{Request, Response, JsonResponse};\n",
      },
      runtime,
    );
    expect(result.parse_error).toBeNull();
    const modules = result.imports.map((i) => i.to_module).sort();
    expect(modules).toEqual([
      "Symfony\\Component\\HttpFoundation\\JsonResponse",
      "Symfony\\Component\\HttpFoundation\\Request",
      "Symfony\\Component\\HttpFoundation\\Response",
    ]);
    expect(result.imports.every((i) => i.is_default === true)).toBe(true);
  });
});

describe("parsePhp — D-27 all-or-nothing parse error", () => {
  it("returns ParseErrorRecord on syntax error (ERROR node)", async () => {
    // Unterminated function declaration produces an ERROR node tree-sitter-php cannot recover from.
    const result = await parsePhp(
      {
        file_path: "broken.php",
        source_text: "<?php\nfunction f($\n",
      },
      runtime,
    );
    expect(result.parse_error).not.toBeNull();
    expect(result.parse_error?.source).toBe("tree-sitter");
    expect(result.raw_ast).toBeNull();
    expect(result.imports).toEqual([]);
  });

  it("returns ParseErrorRecord on garbage content", async () => {
    const result = await parsePhp(
      { file_path: "garbage.php", source_text: "<?php @@@!!!---" },
      runtime,
    );
    expect(result.parse_error).not.toBeNull();
    expect(result.raw_ast).toBeNull();
  });
});
