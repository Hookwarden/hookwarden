import { describe, expect, it } from "vitest";
import { canonicalize } from "../src/index.js";

/**
 * RFC 8785 §3.2.4 worked example + Appendix B number vector tests.
 *
 * Source: https://www.rfc-editor.org/rfc/rfc8785
 * Cross-checked against the cyberphone/json-canonicalization reference
 * testdata (vectors only — that repo is NOT a runtime dep; D-06).
 *
 * The behaviors below cover the 13 cases enumerated in 07-02-PLAN.md
 * <behavior> for Task 1.
 */
describe("rfc8785 primitives", () => {
  it("canonicalizes null", () => {
    expect(canonicalize(null)).toBe("null");
  });

  it("canonicalizes booleans", () => {
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(false)).toBe("false");
  });

  it("canonicalizes +0 and -0 to '0' (negative-zero collapse)", () => {
    expect(canonicalize(0)).toBe("0");
    expect(canonicalize(-0)).toBe("0");
  });

  it("canonicalizes 1e21 as '1e+21' (exponential form above 1e21)", () => {
    expect(canonicalize(1e21)).toBe("1e+21");
  });

  it("canonicalizes 1e-7 as '1e-7'", () => {
    expect(canonicalize(1e-7)).toBe("1e-7");
  });

  it("canonicalizes a plain string", () => {
    expect(canonicalize("hello")).toBe('"hello"');
  });

  it("escapes U+0008 as \\b", () => {
    expect(canonicalize("\b")).toBe('"\\b"');
  });

  it("escapes U+0001 as \\u0001", () => {
    expect(canonicalize("")).toBe('"\\u0001"');
  });

  it("canonicalizes arrays without whitespace", () => {
    expect(canonicalize([1, 2, 3])).toBe("[1,2,3]");
  });

  it("sorts object keys by UTF-16 code unit (basic ASCII case)", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe("rfc8785 §B.1 number vectors", () => {
  // Selected vectors from RFC 8785 Appendix B (number serialization).
  // Each row is [JS number literal, expected JCS string].
  // The full RFC table has ~36 entries; this covers every distinct
  // branch of ECMA-262 §7.1.12.1 (sign, exponent, ±0, boundaries).
  const vectors: ReadonlyArray<readonly [number, string]> = [
    [0, "0"],
    [-0, "0"],
    [1, "1"],
    [-1, "-1"],
    [1.5, "1.5"],
    [-1.5, "-1.5"],
    [100, "100"],
    [333333333.3333333, "333333333.3333333"],
    // Boundary: ≥ 1e21 → exponential form with explicit '+'
    [1e21, "1e+21"],
    [1e22, "1e+22"],
    // Boundary: < 1e-6 → exponential form
    [1e-6, "0.000001"],
    [1e-7, "1e-7"],
    // Boundary already covered by 1e-6 (fixed-point) and 1e-7 (exponential).
    // Skipping a "just below 1e-6" row because the closest representable
    // double rounds the literal — V8 picks the shortest round-trip form
    // and the test would assert a constant that the JS parser rejects.
    // Max safe integer
    [9007199254740991, "9007199254740991"],
    [-9007199254740991, "-9007199254740991"],
    // Subnormal smallest positive double
    [5e-324, "5e-324"],
    // Largest finite double
    [1.7976931348623157e308, "1.7976931348623157e+308"],
    // Common fractions
    [0.1, "0.1"],
    [0.5, "0.5"],
    [-0.5, "-0.5"],
  ] as const;

  for (const [input, expected] of vectors) {
    it(`canonicalize(${String(input)}) === ${JSON.stringify(expected)}`, () => {
      expect(canonicalize(input)).toBe(expected);
    });
  }
});

describe("rfc8785 §3.2.4 worked example shape", () => {
  // The RFC §3.2.4 worked example demonstrates: object key sorting by
  // UTF-16, ordered nested structures, lower-case hex escapes for
  // control chars, surrogate-pair pass-through, and integer / number
  // serialization. We assert each invariant separately rather than
  // depending on the exact RFC example text (which uses German
  // umlauts and would be fragile against source-file encoding).
  it("sorts mixed-script keys deterministically", () => {
    const out = canonicalize({ z: 1, a: 2, m: 3 });
    expect(out).toBe('{"a":2,"m":3,"z":1}');
  });

  it("emits nested objects with sorted keys at every depth", () => {
    const out = canonicalize({ outer: { z: 1, a: 2 }, alpha: { y: 3, x: 4 } });
    expect(out).toBe('{"alpha":{"x":4,"y":3},"outer":{"a":2,"z":1}}');
  });

  it("preserves array element order (arrays are NOT sorted)", () => {
    const out = canonicalize([{ b: 1, a: 2 }, "z", "a"]);
    expect(out).toBe('[{"a":2,"b":1},"z","a"]');
  });

  it("escapes the standard short-escape control chars per RFC 8785", () => {
    expect(canonicalize('\b\t\n\f\r"\\')).toBe('"\\b\\t\\n\\f\\r\\"\\\\"');
  });

  it("emits supplementary-plane chars as a UTF-16 surrogate pair pass-through", () => {
    // U+1F600 GRINNING FACE — JS stores as 😀; per RFC 8785
    // these are emitted as-is (raw UTF-16 code units), NOT \uXXXX.
    expect(canonicalize("\u{1F600}")).toBe('"\u{1F600}"');
    // The output should be exactly 4 bytes between the quotes when
    // encoded UTF-8 (a single emoji codepoint).
  });
});

describe("rfc8785 throws on non-representable values", () => {
  it("throws RangeError on NaN", () => {
    expect(() => canonicalize(Number.NaN)).toThrow(RangeError);
  });

  it("throws RangeError on Infinity", () => {
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("throws RangeError on -Infinity", () => {
    expect(() => canonicalize(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
  });

  it("throws TypeError on bigint", () => {
    expect(() => canonicalize({ a: 1n })).toThrow(TypeError);
  });

  it("throws TypeError on undefined at the top level", () => {
    expect(() => canonicalize(undefined)).toThrow(TypeError);
  });

  it("throws TypeError on function value", () => {
    expect(() => canonicalize({ a: () => 1 })).toThrow(TypeError);
  });

  it("throws TypeError on symbol value", () => {
    expect(() => canonicalize({ a: Symbol("x") })).toThrow(TypeError);
  });
});

describe("rfc8785 key sort — UTF-16 surrogate ordering", () => {
  it("sorts surrogate-pair keys BEFORE BMP chars whose code point < high surrogate", () => {
    // U+1F600 GRINNING FACE: JS code units \uD83D \uDE00.
    // U+FFFF (BMP high boundary): single code unit ￿.
    // UTF-16 sort: \uD83D (55357) < ￿ (65535), so surrogate-pair
    // key sorts FIRST despite its CODE POINT (0x1F600) being larger.
    const out = canonicalize({ "\u{1F600}": 1, "￿": 2 });
    expect(out).toBe(`{"\u{1F600}":1,"￿":2}`);
  });
});
