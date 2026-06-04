import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { parseGo } from "../../src/parsers/go.js";
import { extractGoLiterals } from "../../src/parsers/go-literals.js";
import { type GoRuntime, initGoRuntime } from "../../src/parsers/go-loader.js";
import { resolveGoWasmPath } from "../wasm.js";

let runtime: GoRuntime;

beforeAll(async () => {
  const wasmBytes = readFileSync(resolveGoWasmPath());
  runtime = await initGoRuntime({ wasmBytes: new Uint8Array(wasmBytes) });
}, 30_000);

describe("parseGo — happy path", () => {
  it("parses a simple Go file and returns dialect: 'tree-sitter-go'", async () => {
    const result = await parseGo(
      {
        file_path: "webhook.go",
        source_text:
          'package main\n\nimport "net/http"\n\nfunc handle(w http.ResponseWriter, r *http.Request) {\n}\n',
      },
      runtime,
    );
    expect(result.dialect).toBe("tree-sitter-go");
    expect(result.language).toBe("go");
    expect(result.parse_error).toBeNull();
    expect(result.raw_ast).not.toBeNull();
  });

  it("captures grouped imports with last-path-segment local names", async () => {
    const result = await parseGo(
      {
        file_path: "imports.go",
        source_text: 'package main\n\nimport (\n\t"crypto/hmac"\n\t"net/http"\n)\n',
      },
      runtime,
    );
    expect(result.parse_error).toBeNull();
    const modules = result.imports.map((i) => i.to_module).sort();
    expect(modules).toEqual(["crypto/hmac", "net/http"]);

    const hmac = result.imports.find((i) => i.to_module === "crypto/hmac");
    expect(hmac?.imported_names[0]).toEqual({ local: "hmac", source: "default" });
    expect(hmac?.is_default).toBe(true);

    const nethttp = result.imports.find((i) => i.to_module === "net/http");
    expect(nethttp?.imported_names[0]?.local).toBe("http");
  });

  it("captures aliased imports with the alias as local name", async () => {
    const result = await parseGo(
      {
        file_path: "aliased.go",
        source_text: 'package main\n\nimport gh "github.com/google/go-github/v62/github"\n',
      },
      runtime,
    );
    expect(result.parse_error).toBeNull();
    const edge = result.imports[0];
    expect(edge?.to_module).toBe("github.com/google/go-github/v62/github");
    expect(edge?.imported_names[0]).toEqual({ local: "gh", source: "default" });
  });
});

describe("extractGoLiterals", () => {
  it("emits kind:'string' for every string-shaped literal (never 'template')", async () => {
    const result = await parseGo(
      {
        file_path: "literals.go",
        source_text:
          "package main\n\nfunc f() {\n\ts := \"interpreted\"\n\tr := `raw`\n\tc := 'x'\n\tn := 42\n\t_ = s\n\t_ = r\n\t_ = c\n\t_ = n\n}\n",
      },
      runtime,
    );
    expect(result.parse_error).toBeNull();
    const spans = extractGoLiterals(result.raw_ast as Parameters<typeof extractGoLiterals>[0]);
    const stringSpans = spans.filter((s) => s.kind === "string");
    const values = stringSpans.map((s) => s.value).sort();
    expect(values).toEqual(["interpreted", "raw", "x"]);
    expect(spans.some((s) => s.kind === "template")).toBe(false);
    expect(spans.some((s) => s.kind === "number" && s.value === "42")).toBe(true);
  });
});

describe("parseGo — D-27 all-or-nothing parse error", () => {
  it("returns ParseErrorRecord on syntax error (ERROR node), never a silent skip", async () => {
    const result = await parseGo(
      {
        file_path: "broken.go",
        source_text: "package main\n\nfunc f( {\n",
      },
      runtime,
    );
    expect(result.parse_error).not.toBeNull();
    expect(result.parse_error?.source).toBe("tree-sitter");
    expect(result.raw_ast).toBeNull();
    expect(result.imports).toEqual([]);
  });

  it("returns ParseErrorRecord on garbage content", async () => {
    const result = await parseGo(
      { file_path: "garbage.go", source_text: "@@@!!!--- not go at all" },
      runtime,
    );
    expect(result.parse_error).not.toBeNull();
    expect(result.raw_ast).toBeNull();
  });
});
