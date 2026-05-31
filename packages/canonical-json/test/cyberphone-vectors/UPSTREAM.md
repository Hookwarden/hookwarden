# Cyberphone JCS reference vectors

Reference test vectors for RFC 8785 JSON Canonicalization Scheme (JCS).

## Source

- Repository: <https://github.com/cyberphone/json-canonicalization>
- Author: Anders Rundgren
- License: Apache License 2.0 (same as `@hookwarden/canonical-json`)
- Pinned commit: `19d51d7fe467d4706a3ff08adf8a748f29fc21e0`
- Path in upstream: `testdata/input/*.json` and `testdata/output/*.json`
- Fetched: 2026-05-17

## Why these vectors live here

The package's `rfc8785-vectors.test.ts` covers RFC 8785 primitives and
Appendix B number vectors written from scratch. Those tests prove the
encoder is internally consistent. They do **not** prove the encoder
agrees with the de-facto reference implementation (Anders Rundgren's
Java + Go + JS implementations under `cyberphone/json-canonicalization`).

L3 from the 2026-05-17 security review of plan 07-03 flagged this gap:
EVIDENCE-03 claims auditors verify audit-log exports offline, potentially
in a different language. The verifier must produce the same canonical
bytes as our writer. The cross-language conformance is a frozen
cyberphone vector snapshot + `cross-language-conformance.test.ts` that
asserts byte-for-byte agreement.

## Refresh procedure

These are pinned to a specific commit on purpose — auditor evidence
packs must reproduce against a known reference. To bump the pin:

```bash
UPSTREAM_SHA=<new-commit-sha>
mkdir -p /tmp/jcs-vectors/input /tmp/jcs-vectors/output
for name in arrays french structures unicode values weird; do
  gh api "repos/cyberphone/json-canonicalization/contents/testdata/input/${name}.json?ref=${UPSTREAM_SHA}" --jq '.content' | base64 -d > "/tmp/jcs-vectors/input/${name}.json"
  gh api "repos/cyberphone/json-canonicalization/contents/testdata/output/${name}.json?ref=${UPSTREAM_SHA}" --jq '.content' | base64 -d > "/tmp/jcs-vectors/output/${name}.json"
done
cp /tmp/jcs-vectors/input/*.json packages/canonical-json/test/cyberphone-vectors/input/
cp /tmp/jcs-vectors/output/*.json packages/canonical-json/test/cyberphone-vectors/output/
# Update the "Pinned commit" line in this file.
```

## Coverage map

| Vector       | Exercises                                                       |
|--------------|-----------------------------------------------------------------|
| `arrays`     | Mixed-type array elements + nested object key sorting           |
| `french`     | Locale-insensitive code-point sort across French diacritics     |
| `structures` | Empty objects, empty-string keys, deeply nested key ordering    |
| `unicode`    | NO Unicode normalization — A + combining ring stays two codepoints |
| `values`     | Number serialization, string escapes (control + slash), literals|
| `weird`      | Surrogate pairs, control chars, `</script>` (must NOT escape `/`) |
