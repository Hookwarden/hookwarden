import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { redactSnippet, type LiteralSpan } from "../../src/redaction/structural.js";

describe("redactSnippet — security property: no string literal value survives", () => {
  it("any string literal value is absent from the output", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 4, maxLength: 30 }).filter((s) => /^[A-Za-z0-9._-]+$/.test(s)),
        (literalValue) => {
          const source_text = `const secret = "${literalValue}";`;
          const start = source_text.indexOf(`"${literalValue}"`);
          const span: LiteralSpan = {
            kind: "string",
            start,
            end: start + literalValue.length + 2, // +2 for surrounding quotes
            value: literalValue,
          };
          const redacted = redactSnippet({ source_text, literals: [span] });
          // The literal value MUST NOT appear in the redacted output.
          expect(redacted.includes(literalValue)).toBe(false);
          expect(redacted).toContain(`<STRING:${literalValue.length}>`);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("redactSnippet — usability property: identifiers survive", () => {
  it("variable and function identifiers appear unchanged", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 3, maxLength: 12 }).filter((s) => /^[a-z][A-Za-z0-9]*$/.test(s)),
        fc.string({ minLength: 3, maxLength: 12 }).filter((s) => /^[a-z][A-Za-z0-9]*$/.test(s)),
        (varName, fnName) => {
          const source_text = `const ${varName} = ${fnName}("hello");`;
          const stringStart = source_text.indexOf('"hello"');
          const span: LiteralSpan = {
            kind: "string",
            start: stringStart,
            end: stringStart + 7,
            value: "hello",
          };
          const redacted = redactSnippet({ source_text, literals: [span] });
          // Identifiers are preserved (D-39).
          expect(redacted).toContain(varName);
          expect(redacted).toContain(fnName);
          expect(redacted).toContain("<STRING:5>");
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("redactSnippet — secret-literal-prefix overlay (D-39 + D-33)", () => {
  it("string literals matching a provider's secret_literal_prefix become <SECRET_LITERAL>", () => {
    const source_text = `const k = "whsec_abc123";`;
    const start = source_text.indexOf('"whsec_abc123"');
    const span: LiteralSpan = {
      kind: "string",
      start,
      end: start + 14,
      value: "whsec_abc123",
    };
    const redacted = redactSnippet({
      source_text,
      literals: [span],
      secret_literal_prefixes: ["whsec_"],
    });
    expect(redacted).toContain("<SECRET_LITERAL>");
    expect(redacted).not.toContain("whsec_abc123");
    expect(redacted).not.toContain("<STRING:");
  });

  it("explicit secret-kind literals always emit <SECRET_LITERAL>", () => {
    const source_text = `const k = "whatever";`;
    const start = source_text.indexOf('"whatever"');
    const span: LiteralSpan = {
      kind: "secret",
      start,
      end: start + 10,
      value: "whatever",
    };
    const redacted = redactSnippet({ source_text, literals: [span] });
    expect(redacted).toContain("<SECRET_LITERAL>");
    expect(redacted).not.toContain("whatever");
  });
});

describe("redactSnippet — number / template / regex placeholders", () => {
  it("emits <NUMBER>, <TEMPLATE>, <REGEX> for the matching kinds", () => {
    const source_text = "const n = 42; const t = `hi`; const r = /abc/;";
    const literals: LiteralSpan[] = [
      { kind: "number", start: 10, end: 12, value: "42" },
      { kind: "template", start: 23, end: 27, value: "`hi`" },
      { kind: "regex", start: 38, end: 43, value: "/abc/" },
    ];
    const redacted = redactSnippet({ source_text, literals });
    expect(redacted).toContain("<NUMBER>");
    expect(redacted).toContain("<TEMPLATE>");
    expect(redacted).toContain("<REGEX>");
    expect(redacted).not.toContain("42");
    expect(redacted).not.toContain("`hi`");
    expect(redacted).not.toContain("/abc/");
  });

  it("zero-literal input is returned untouched", () => {
    const source_text = "function noop() { return; }";
    expect(redactSnippet({ source_text, literals: [] })).toBe(source_text);
  });
});
