import { describe, expect, it } from "vitest";
import { canonicalize } from "../src/index.js";

/**
 * Explicit table-driven throw cases.
 *
 * These overlap with the property test's non-finite check at the top
 * level, but are kept SEPARATE because:
 *   - Property-based tests over a fixed throw-table are wasteful.
 *   - This file is the single grep target an auditor can scan to
 *     confirm "every non-JSON value class has an explicit throw test".
 *   - Maps the D-06 invariant directly: every value class JSON cannot
 *     represent MUST raise rather than silently coerce.
 */
describe("canonicalize throws on every non-JSON value class", () => {
  const cases: ReadonlyArray<{
    name: string;
    factory: () => unknown;
    errorClass: ErrorConstructor;
  }> = [
    { name: "NaN", factory: () => Number.NaN, errorClass: RangeError },
    {
      name: "Infinity",
      factory: () => Number.POSITIVE_INFINITY,
      errorClass: RangeError,
    },
    {
      name: "-Infinity",
      factory: () => Number.NEGATIVE_INFINITY,
      errorClass: RangeError,
    },
    {
      name: "bigint (top-level)",
      factory: () => 1n,
      errorClass: TypeError,
    },
    {
      name: "bigint (nested in object)",
      factory: () => ({ a: 1n }),
      errorClass: TypeError,
    },
    {
      name: "Symbol",
      factory: () => Symbol("x"),
      errorClass: TypeError,
    },
    {
      name: "Symbol (nested in array)",
      factory: () => [Symbol("x")],
      errorClass: TypeError,
    },
    {
      name: "undefined (top-level)",
      factory: () => undefined,
      errorClass: TypeError,
    },
    {
      name: "undefined (nested in object)",
      factory: () => ({ a: undefined }),
      errorClass: TypeError,
    },
    {
      name: "function",
      factory: () => () => 1,
      errorClass: TypeError,
    },
    {
      name: "function (nested in array)",
      factory: () => [() => 1],
      errorClass: TypeError,
    },
  ];

  for (const { name, factory, errorClass } of cases) {
    it(`throws ${errorClass.name} on ${name}`, () => {
      expect(() => canonicalize(factory())).toThrow(errorClass);
    });
  }
});
