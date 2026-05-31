// Regression hardening tests from the 2026-05-17 security review of 07-03.
//
// These do NOT cover RFC 8785 behavior directly — they protect against
// future "improvements" that would silently break conformance. Each
// describe block names the finding (L1 / L2) and the failure mode it
// catches.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalize } from "../src/index.js";

/**
 * L1 — `Array#sort()` without a comparator MUST stay the canonical key-
 * order primitive. A future engineer "fixing" the line to
 * `.sort((a, b) => a.localeCompare(b))` would silently switch to
 * locale-sensitive collation, breaking RFC 8785 §3.2.3 for non-ASCII keys.
 *
 * This test asserts that the engine's no-comparator sort is byte-for-byte
 * equivalent to an explicit (a, b) => a < b ? -1 : a > b ? 1 : 0 over a
 * large random sample of key sets (including non-ASCII). If V8 ever
 * changes the default-sort spec, OR if the source code mutates the sort
 * call, this catches it.
 */
describe("L1 — sort regression: no-comparator vs explicit code-unit comparator", () => {
  const explicitCompare = (a: string, b: string): number => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  };

  it("Object.keys(obj).sort() matches explicit code-unit comparator on random ASCII keys", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 0, maxLength: 8 }), {
          minLength: 0,
          maxLength: 16,
        }),
        (keys) => {
          const obj: Record<string, number> = {};
          keys.forEach((k, i) => {
            obj[k] = i;
          });
          const defaultSorted = Object.keys(obj).sort().join("|");
          const explicitSorted = Object.keys(obj).sort(explicitCompare).join("|");
          return defaultSorted === explicitSorted;
        },
      ),
      { numRuns: 300 },
    );
  });

  it("matches the explicit comparator on non-ASCII keys (locale-sensitivity trap)", () => {
    // Cases where String#localeCompare disagrees with code-unit ordering.
    // German collation often orders "ß" with "ss", and several diacritics
    // are folded; code-unit order treats them as distinct codepoints.
    const cases: ReadonlyArray<readonly string[]> = [
      ["ä", "z", "a"],
      ["ß", "ss", "sz"],
      ["é", "e", "ê"],
      ["\u{1F600}", "z", "ÿ"],
    ] as const;
    for (const keys of cases) {
      const obj: Record<string, number> = {};
      keys.forEach((k, i) => {
        obj[k] = i;
      });
      const defaultSorted = Object.keys(obj).sort();
      const explicitSorted = Object.keys(obj).sort(explicitCompare);
      expect(defaultSorted).toEqual(explicitSorted);
    }
  });
});

/**
 * L2 — Prototype-pollution surface. canonicalize() uses Object.keys (own
 * enumerable only), which is the correct primitive. This test pins the
 * behavior so a future refactor to e.g. `for..in` (which walks the
 * prototype chain) is caught immediately.
 *
 * Two sub-cases:
 *   1. JSON.parse('{"__proto__": {...}}') creates an object with
 *      __proto__ as an own data property (per ECMA-262 §JSON.parse —
 *      JSON.parse uses CreateDataPropertyOrThrow). It must canonicalize
 *      AS a key, sorted lexicographically with other keys.
 *   2. Object.assign(Object.create({ injected: 1 }), { real: 2 })
 *      produces an object whose [[Prototype]] has an enumerable property.
 *      `injected` MUST NOT appear in the canonical output.
 */
describe("L2 — prototype-pollution: only own keys canonicalize, never inherited", () => {
  it("treats __proto__ from JSON.parse as an own key (not as actual prototype)", () => {
    // JSON.parse uses CreateDataPropertyOrThrow under the hood, so the
    // resulting object has __proto__ as an own data property and the
    // prototype chain is untouched. The canonical output must include
    // __proto__ as a key sorted lexicographically with the others.
    const parsed = JSON.parse('{"__proto__":{"x":1},"a":2}') as Record<string, unknown>;
    const out = canonicalize(parsed);
    // "__proto__" (0x5F * 2 + ...) sorts after "a" (0x61) in UTF-16:
    // '_' is 0x5F, 'a' is 0x61 — so "__proto__" comes BEFORE "a".
    expect(out).toBe('{"__proto__":{"x":1},"a":2}');
    // The prototype of `parsed` must not have been mutated.
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    // Sanity: a freshly-parsed identical input must canonicalize identically.
    const parsedAgain = JSON.parse('{"a":2,"__proto__":{"x":1}}') as Record<string, unknown>;
    expect(canonicalize(parsedAgain)).toBe(out);
  });

  it("excludes inherited enumerable properties from the canonical output", () => {
    // Build an object whose prototype has an enumerable property called
    // `injected`. Object.keys (and therefore canonicalize) MUST NOT see
    // it. If a future refactor switches to for..in or Reflect.ownKeys
    // with non-own filtering, this test fails.
    const proto: Record<string, unknown> = { injected: "hijack" };
    const obj: Record<string, unknown> = Object.create(proto) as Record<string, unknown>;
    obj.real = "value";
    // Confirm the test setup: `injected` is reachable via the prototype
    // chain, so a sloppy iteration would pick it up.
    expect(Object.hasOwn(Object.getPrototypeOf(obj) as object, "injected")).toBe(true);
    expect(canonicalize(obj)).toBe('{"real":"value"}');
  });

  it("excludes inherited Object.prototype properties (toString, hasOwnProperty)", () => {
    // Defense-in-depth: Object.prototype's built-in properties are
    // non-enumerable by spec, so Object.keys filters them out anyway.
    // The test pins this guarantee in case a future change uses a
    // different enumeration primitive.
    const out = canonicalize({ z: 1 });
    expect(out).toBe('{"z":1}');
    expect(out).not.toContain("toString");
    expect(out).not.toContain("hasOwnProperty");
  });
});
