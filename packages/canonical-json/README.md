# @hookwarden/canonical-json

An in-house RFC 8785 JSON Canonicalization Scheme (JCS) encoder. Zero
runtime dependencies. Pure ECMAScript, no Node built-ins — vendorable
into auditor tooling.

## Why this package exists

Hookwarden's audit log signs canonical bytes (Phase 7) and exports
evidence packs (Phase 12) that auditors verify with non-JS tooling
(Python `cryptography`, Go `crypto/ecdsa`, Java). The encoding MUST
be deterministic and cross-language re-derivable. JCS (RFC 8785) is
the only ratified standard meeting that bar. `JSON.stringify` does
not — its key order is engine-defined and it silently coerces NaN/
Infinity to `"null"`.

The reference implementation `@cyberphone/json-canonicalization` is
**unmaintained since 2020**, so we re-implement in-house with a
property-based test against the RFC §B vectors (decision D-06).

## API

```ts
import { canonicalize } from "@hookwarden/canonical-json";

canonicalize({ b: 1, a: 2 });   // '{"a":2,"b":1}'
canonicalize([1, 2, 3]);        // '[1,2,3]'
canonicalize(1e21);             // '1e+21'
canonicalize(NaN);              // throws RangeError
canonicalize(undefined);        // throws TypeError
```

The function throws on values JSON cannot represent (NaN, ±Infinity,
bigint, symbol, undefined, function) rather than silently coercing.
This is the D-06 correctness invariant that makes evidence packs
cross-language verifiable.

## References

- [RFC 8785 — JSON Canonicalization Scheme (JCS)](https://www.rfc-editor.org/rfc/rfc8785) — algorithm definition + Appendix B number-serialization test vectors.
- [@cyberphone/json-canonicalization](https://github.com/cyberphone/json-canonicalization) — the original RFC 8785 reference impl. **Cited for test vectors only — NOT a runtime dependency** (unmaintained since 2020; D-06 explicitly rejects it as a runtime dep).
