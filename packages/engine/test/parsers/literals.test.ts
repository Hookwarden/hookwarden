import { describe, expect, it } from "vitest";
import { parseJsTs } from "../../src/parsers/babel.js";
import { extractBabelLiterals } from "../../src/parsers/literals.js";

async function literalsFor(source_text: string) {
  const file = await parseJsTs({ file_path: "x.ts", source_text });
  return extractBabelLiterals(file.raw_ast as Parameters<typeof extractBabelLiterals>[0]);
}

describe("extractBabelLiterals", () => {
  it("captures string, number, template, regex literals", async () => {
    const literals = await literalsFor(
      "const s = 'hello'; const n = 42; const t = `x${1}`; const r = /abc/g;",
    );
    const kinds = literals.map((l) => l.kind);
    expect(kinds).toContain("string");
    expect(kinds).toContain("number");
    expect(kinds).toContain("template");
    expect(kinds).toContain("regex");
  });

  it("captures nested literals (function args, object properties)", async () => {
    const literals = await literalsFor(
      `app.post('/webhooks/stripe', { body: 'json', limit: 100 }, handler);`,
    );
    const strings = literals.filter((l) => l.kind === "string").map((l) => l.value);
    expect(strings).toContain("/webhooks/stripe");
    expect(strings).toContain("json");
    expect(literals.find((l) => l.kind === "number" && l.value === "100")).toBeDefined();
  });

  it("returns spans in ascending start order for splice safety", async () => {
    const literals = await literalsFor(
      "const a = 'first'; const b = 'second'; const c = 'third';",
    );
    for (let i = 1; i < literals.length; i++) {
      const prev = literals[i - 1]!;
      const cur = literals[i]!;
      expect(cur.start).toBeGreaterThanOrEqual(prev.start);
    }
  });

  it("returns empty array on null AST (parse-error file)", () => {
    const literals = extractBabelLiterals(null);
    expect(literals).toEqual([]);
  });

  it("captures literal value text exactly so the redactor can verify length", async () => {
    const literals = await literalsFor(`const k = "whsec_abc";`);
    const literal = literals.find((l) => l.kind === "string");
    expect(literal?.value).toBe("whsec_abc");
    expect(literal?.value.length).toBe(9);
  });
});
