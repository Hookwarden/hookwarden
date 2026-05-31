import { escapeString } from "./escape.js";
import { serializeNumber } from "./number.js";

/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 *
 * Returns a deterministic string representation of `value` such that
 * `canonicalize(a) === canonicalize(b)` iff `a` and `b` are
 * structurally equal JSON-shaped values.
 *
 * Algorithm (RFC 8785 §3.2):
 *   null    → "null"
 *   boolean → "true" / "false"
 *   number  → ECMA-262 §7.1.12.1 (see number.ts)
 *   string  → "\"" + escape (see escape.ts) + "\""
 *   array   → "[" + comma-joined canonicalize(elem) + "]"
 *   object  → "{" + comma-joined sorted-by-UTF16-key entries + "}"
 *
 * Key sort: object keys MUST be sorted by their UTF-16 code-unit
 * sequence (RFC 8785 §3.2.3). ECMA-262 §22.1.3.27 (Array.prototype.sort
 * without a comparator) sorts strings by exactly this ordering when the
 * elements are strings: the abstract operation produces UTF-16
 * code-unit lexicographic order. We rely on `.sort()` without a
 * comparator deliberately for this guarantee — passing a comparator
 * would shift us to engine-defined behaviour.
 *
 * @throws {RangeError} on NaN, Infinity, -Infinity (from serializeNumber).
 * @throws {TypeError} on bigint, symbol, undefined, function — values
 *   that JSON cannot represent. Refusing to coerce (vs silently
 *   dropping or emitting "null") is the D-06 correctness invariant
 *   that makes evidence packs verifiable cross-language.
 */
export function canonicalize(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    throw new TypeError("canonical-json: cannot serialize undefined (not representable in JSON)");
  }
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return serializeNumber(value);
    case "string":
      return `"${escapeString(value)}"`;
    case "bigint":
      throw new TypeError("canonical-json: cannot serialize bigint (not representable in JSON)");
    case "symbol":
      throw new TypeError("canonical-json: cannot serialize symbol (not representable in JSON)");
    case "function":
      throw new TypeError("canonical-json: cannot serialize function (not representable in JSON)");
    case "object": {
      if (Array.isArray(value)) {
        return canonicalizeArray(value);
      }
      return canonicalizeObject(value as Record<string, unknown>);
    }
    default:
      throw new TypeError(`canonical-json: cannot serialize value of type ${typeof value}`);
  }
}

function canonicalizeArray(arr: unknown[]): string {
  // JSON.stringify silently emits "null" for undefined / function /
  // symbol array entries — we refuse and throw, consistent with the
  // top-level contract.
  const parts: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    parts.push(canonicalize(arr[i]));
  }
  return `[${parts.join(",")}]`;
}

function canonicalizeObject(obj: Record<string, unknown>): string {
  // Object.keys returns own enumerable string keys in insertion order.
  // We sort BY UTF-16 code unit per RFC 8785 §3.2.3. Array#sort with
  // no comparator does exactly this for strings (ECMA-262 §23.1.3.30
  // / §22.1.3.27 — the abstract SortCompare on strings is UTF-16
  // code-unit lexicographic).
  //
  // DO NOT add a comparator to .sort() — passing one (including
  // String#localeCompare) switches to locale-sensitive collation and
  // silently breaks RFC 8785 conformance for non-ASCII keys. The
  // regression test `regression-hardening.test.ts` asserts equivalence
  // with an explicit (a, b) => a < b ? -1 : a > b ? 1 : 0 comparator
  // so a future "improvement" here fails CI.
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    // JSON.stringify drops keys whose value is undefined / function /
    // symbol. JCS does not specify a drop behavior; we throw (caller
    // bug) rather than silently coerce, matching the array case.
    parts.push(`"${escapeString(k)}":${canonicalize(v)}`);
  }
  return `{${parts.join(",")}}`;
}
