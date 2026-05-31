/**
 * ECMA-262 §7.1.12.1 Number-to-String serializer.
 *
 * Per RFC 8785 §3.2.2.3, JSON numbers MUST be serialized using the
 * ECMA-262 algorithm. Node's built-in `String(n)` / `n.toString()` is
 * already specified to implement this exact algorithm, so we delegate
 * to it AFTER rejecting the values that the algorithm refuses to
 * handle (NaN, ±Infinity).
 *
 * Why we do not call the built-in JSON serializer here:
 *   - It returns `"null"` silently for NaN — that is the
 *     exact bug D-06 protects against (auditor evidence packs MUST
 *     fail loudly, not coerce).
 *   - This package IS the alternative to `JSON.stringify`; using it
 *     internally would defeat the architectural invariant D-19
 *     enforces in 07-04.
 *
 * Edge cases covered by RFC 8785 Appendix B vectors (see
 * test/rfc8785-vectors.test.ts):
 *   - `0` and `-0` both serialize as `"0"` (negative-zero collapse).
 *   - `1e21` serializes as `"1e+21"` (exponential form above 1e21).
 *   - `1e-7` serializes as `"1e-7"` (exponential form below 1e-6).
 *   - Plain integers in [1e-6, 1e21) use fixed-point form.
 *
 * @throws {RangeError} on NaN, Infinity, -Infinity.
 */
export function serializeNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new RangeError(
      `canonical-json: cannot serialize non-finite number ${String(n)} (RFC 8785 requires JSON-representable values)`,
    );
  }
  // Negative-zero collapse: ECMA-262 §7.1.12.1 step 2 says -0 → "0".
  if (n === 0) {
    return "0";
  }
  // V8's `String(n)` implements ECMA-262 §7.1.12.1 verbatim. Verified
  // against RFC 8785 Appendix B number vectors in the vector test.
  return String(n);
}
