import fc from "fast-check";
import { describe, it } from "vitest";
import { canonicalize } from "../src/index.js";

/**
 * Property-based tests for RFC 8785 canonicalize().
 *
 * fc.jsonValue() generates the JSON-representable subset
 * (null / boolean / number / string / array / object), which is
 * exactly the input domain of `canonicalize`. Non-finite numbers
 * are not in `jsonValue()`'s range, so determinism / idempotence
 * properties are unconditional.
 */
describe("canonicalize property: determinism", () => {
  it("produces the same output for the same input across runs", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const a = canonicalize(v);
        const b = canonicalize(v);
        return a === b;
      }),
      { numRuns: 500 },
    );
  });
});

describe("canonicalize property: idempotence under JSON round-trip", () => {
  it("canonicalize(JSON.parse(canonicalize(v))) === canonicalize(v)", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const once = canonicalize(v);
        // JSON.parse is the well-tested inverse for canonical output.
        // canonicalize(parse(canonicalize(v))) should equal canonicalize(v).
        // (NOTE: this is the ONLY JSON.parse call in this package and it
        // lives in TEST code — D-19 forbids JSON.stringify, not JSON.parse.)
        const parsed = JSON.parse(once) as unknown;
        return canonicalize(parsed) === once;
      }),
      { numRuns: 500 },
    );
  });
});

describe("canonicalize property: no whitespace in output", () => {
  it("output never contains space, tab, newline, or carriage return outside escaped strings", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const out = canonicalize(v);
        // Canonical JSON is whitespace-free at the structural level.
        // We allow escaped whitespace inside strings (\n, \t, etc.)
        // but never raw whitespace at the byte level — since our
        // escape.ts converts those to backslash sequences, the byte
        // stream cannot contain a raw \t, \n, \r, or \f.
        // A literal space CAN appear inside a string value (e.g.
        // canonicalize("a b") === '"a b"') so we exclude space.
        return !/[\t\n\r\f]/.test(out);
      }),
      { numRuns: 200 },
    );
  });
});

describe("canonicalize property: key-sort stability under permutation", () => {
  it("two objects built from the same key/value pairs in different order canonicalize identically", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.tuple(fc.string(), fc.jsonValue()), {
          selector: (t) => t[0],
          minLength: 0,
          maxLength: 12,
        }),
        (pairs) => {
          const objA: Record<string, unknown> = {};
          for (const [k, v] of pairs) objA[k] = v;
          // Build reversed insertion order.
          const objB: Record<string, unknown> = {};
          for (const [k, v] of [...pairs].reverse()) objB[k] = v;
          return canonicalize(objA) === canonicalize(objB);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("canonicalize property: throws on non-finite at any nesting depth", () => {
  it("throws RangeError when NaN/Infinity/-Infinity is nested 0-4 levels deep", () => {
    const badNumber = fc.constantFrom(
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    );
    const depth = fc.integer({ min: 0, max: 4 });
    fc.assert(
      fc.property(badNumber, depth, (bad, d) => {
        let value: unknown = bad;
        for (let i = 0; i < d; i++) {
          // Alternate wrapping in array and object.
          value = i % 2 === 0 ? [value] : { x: value };
        }
        try {
          canonicalize(value);
          return false; // should have thrown
        } catch (err) {
          return err instanceof RangeError;
        }
      }),
      { numRuns: 100 },
    );
  });
});
